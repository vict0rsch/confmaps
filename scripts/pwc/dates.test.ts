import { describe, expect, it } from 'vitest';
import { padIsoDate, parseDateText } from './dates';

describe('padIsoDate', () => {
  it('zero-pads', () => expect(padIsoDate('2025-2-28')).toBe('2025-02-28'));
  it('keeps padded dates', () => expect(padIsoDate('2024-11-06')).toBe('2024-11-06'));
  it('rejects impossible or malformed dates', () => {
    expect(padIsoDate('2023-02-30')).toBeUndefined();
    expect(padIsoDate('2023/02/03')).toBeUndefined();
  });
});

describe('parseDateText', () => {
  it.each([
    ['Aug 9-12, 2019', '2019-08-09', '2019-08-12'],
    ['December 13-16, 2016', '2016-12-13', '2016-12-16'],
    ['June 13–15, 2016', '2016-06-13', '2016-06-15'],
    ['Sept 12–15, 2017', '2017-09-12', '2017-09-15'],
    ['October, 9-12, 2022', '2022-10-09', '2022-10-12'],
    ['August 3-4 2017', '2017-08-03', '2017-08-04'],
    ['July 30-August 4, 2017', '2017-07-30', '2017-08-04'],
    ['October 31 - November 1, 2018', '2018-10-31', '2018-11-01'],
    ['August 11-August 15, 2017', '2017-08-11', '2017-08-15'],
    ['July 13 - 17, 2019', '2019-07-13', '2019-07-17'],
    ['May 29- June 2, 2023', '2023-05-29', '2023-06-02'],
    ['Feb 28 – Mar 4, 2025', '2025-02-28', '2025-03-04'],
    ['Jul 08-13, 2023', '2023-07-08', '2023-07-13'],
    ['April 30, 2020', '2020-04-30', '2020-04-30'],
    ['December 30 - January 2, 2021', '2020-12-30', '2021-01-02'],
  ])('%s', (text, start, end) => expect(parseDateText(text)).toEqual({ start, end }));

  it.each(['April 2024', 'TBD', 'June 31, 2020', 'June 20-10, 2020', 'Smarch 3, 2020'])(
    'rejects %s',
    (text) => expect(parseDateText(text)).toBeUndefined(),
  );
});
