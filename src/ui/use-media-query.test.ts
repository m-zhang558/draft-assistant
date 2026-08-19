import { renderHook, act } from '@testing-library/react';
import { setMatchMediaQuery } from '../../tests/setup';
import { useMediaQuery } from './use-media-query';

const QUERY = '(max-width: 639px)';

describe('useMediaQuery', () => {
  it('reflects the current match state on first render', () => {
    setMatchMediaQuery(QUERY, true);
    const { result } = renderHook(() => useMediaQuery(QUERY));
    expect(result.current).toBe(true);
  });

  it('reacts to a live change event for the same query', () => {
    setMatchMediaQuery(QUERY, false);
    const { result } = renderHook(() => useMediaQuery(QUERY));
    expect(result.current).toBe(false);

    act(() => {
      setMatchMediaQuery(QUERY, true);
    });

    expect(result.current).toBe(true);
  });

  it('tracks each query string independently', () => {
    setMatchMediaQuery('(max-width: 100px)', true);
    setMatchMediaQuery('(max-width: 200px)', false);

    const narrow = renderHook(() => useMediaQuery('(max-width: 100px)'));
    const wide = renderHook(() => useMediaQuery('(max-width: 200px)'));

    expect(narrow.result.current).toBe(true);
    expect(wide.result.current).toBe(false);
  });
});
