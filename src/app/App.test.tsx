import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { useBoardStore } from '@/state';
import { setMatchMediaQuery } from '../../tests/setup';

const DARK_QUERY = '(prefers-color-scheme: dark)';

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
    act(() => {
      useBoardStore.getState().setTheme('system');
    });
    setMatchMediaQuery(DARK_QUERY, false);
  });

  it('renders the header, toolbar, board, and footer for the default format', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'Fantasy Assist' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Ranking format' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Row density' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Position' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search players by name or team')).toBeInTheDocument();
    expect(screen.getByText('Available only')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Ranked players' })).toBeInTheDocument();
    expect(screen.getByText(/Redraft PPR — 426 players, 0 drafted/)).toBeInTheDocument();
  });

  it('applies theme to the document element, resolving "system" through matchMedia and reacting to a live OS flip', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Default theme is 'system' and the mocked query does not match dark -> resolves light.
    expect(document.documentElement.dataset.theme).toBe('light');

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');

    await user.click(screen.getByRole('radio', { name: 'System' }));
    expect(document.documentElement.dataset.theme).toBe('light');

    // A live OS theme change while "system" is selected must repaint without a remount.
    act(() => {
      setMatchMediaQuery(DARK_QUERY, true);
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
