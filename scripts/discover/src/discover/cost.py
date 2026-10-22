"""Token/tool usage accounting and a USD estimate.

Prices are Anthropic first-party list prices (claude-api skill, cached 2026-10-06), USD:
per million tokens for input / output / 5-minute cache write / cache read, and $10 per 1,000
web searches. Web fetch has no per-request charge (fetched content is billed as input tokens).
No code-execution fee is modelled: the request declares no ``code_execution`` tool, and the
code execution the API provisions for the web tools' dynamic filtering has no charge beyond
tokens (web search / web fetch tool docs, checked 2026-10-22). Declaring that tool would need
a container-time line here.
"""

from dataclasses import dataclass, field
from typing import Any, Self


@dataclass(frozen=True)
class Price:
    input: float
    output: float
    cache_write: float
    cache_read: float


PRICES: dict[str, Price] = {
    "claude-opus-5-5": Price(4.00, 20.00, 5.00, 0.20),
    # Possible server-side fallback targets for claude-opus-5-5.
    "claude-opus-5": Price(5.00, 25.00, 6.25, 0.50),
    "claude-opus-4-8": Price(5.00, 25.00, 6.25, 0.50),
}
WEB_SEARCH_USD_PER_1K = 10.00


@dataclass
class Usage:
    requests: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0
    web_search_requests: int = 0
    web_fetch_requests: int = 0
    token_usd: float = 0.0
    unpriced_models: set[str] = field(default_factory=set)

    @property
    def search_usd(self) -> float:
        return self.web_search_requests * WEB_SEARCH_USD_PER_1K / 1000

    @property
    def usd(self) -> float:
        return self.token_usd + self.search_usd

    def add_tokens(self, model: str, inp: int, out: int, cw: int, cr: int) -> None:
        self.input_tokens += inp
        self.output_tokens += out
        self.cache_creation_input_tokens += cw
        self.cache_read_input_tokens += cr
        price = PRICES.get(model)
        if price is None:
            self.unpriced_models.add(model)
            return
        self.token_usd += (
            inp * price.input + out * price.output + cw * price.cache_write + cr * price.cache_read
        ) / 1e6

    def add_response(self, message: Any, requested_model: str) -> None:
        """Add one API response's ``usage``.

        After a server-side fallback, top-level ``usage`` covers only the attempt that produced
        the message, so the per-attempt ``usage.iterations`` entries are summed instead, each at
        its own model's price.

        Parameters
        ----------
        message : Any
            A ``BetaMessage`` (or an object with the same ``usage`` / ``model`` attributes).
        requested_model : str
            Model to price tokens at when the response does not name one.

        Examples
        --------
        .. code-block:: python

            usage = Usage()
            usage.add_response(stream.get_final_message(), "claude-opus-5-5")
            print(f"${usage.usd:.2f}")
        """
        u = message.usage
        self.requests += 1
        iterations = list(getattr(u, "iterations", None) or [])
        if any(getattr(it, "type", None) == "fallback_message" for it in iterations):
            for it in iterations:
                if it.type in ("message", "fallback_message"):
                    self.add_tokens(
                        getattr(it, "model", None) or requested_model,
                        it.input_tokens,
                        it.output_tokens,
                        it.cache_creation_input_tokens or 0,
                        it.cache_read_input_tokens or 0,
                    )
        else:
            self.add_tokens(
                getattr(message, "model", None) or requested_model,
                u.input_tokens,
                u.output_tokens,
                u.cache_creation_input_tokens or 0,
                u.cache_read_input_tokens or 0,
            )
        stu = getattr(u, "server_tool_use", None)
        if stu is not None:
            self.web_search_requests += stu.web_search_requests or 0
            self.web_fetch_requests += stu.web_fetch_requests or 0

    def __iadd__(self, other: "Usage") -> Self:
        self.requests += other.requests
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cache_creation_input_tokens += other.cache_creation_input_tokens
        self.cache_read_input_tokens += other.cache_read_input_tokens
        self.web_search_requests += other.web_search_requests
        self.web_fetch_requests += other.web_fetch_requests
        self.token_usd += other.token_usd
        self.unpriced_models |= other.unpriced_models
        return self
