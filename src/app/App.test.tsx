import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { useBoardStore } from '@/state';
import { setMatchMediaQuery } from '../../tests/setup';
import { resetBoardStore } from '../../tests/test-store';

const DARK_QUERY = '(prefers-color-scheme: dark)';

describe('App', () => {
  beforeEach(async () => {
    await resetBoardStore();
    setMatchMediaQuery(DARK_QUERY, false);
  });

  it('renders the header, toolbar, board, and footer for the default board', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'Fantasy Assist' })).toBeInTheDocument();
    expect(screen.getByLabelText('Board')).toBeInTheDocument();
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

  it('shows a persistenceError as a role="alert" banner above the board, without hiding it', () => {
    act(() => {
      useBoardStore.setState({ persistenceError: 'the database worker crashed' });
    });

    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent('the database worker crashed');
    expect(screen.getByRole('list', { name: 'Ranked players' })).toBeInTheDocument();
  });
});

describe('App boot states', () => {
  beforeEach(async () => {
    await resetBoardStore();
  });

  it('renders a minimal loading shell while status is "loading", never the board', () => {
    act(() => {
      useBoardStore.setState({ status: 'loading' });
    });

    render(<App />);

    expect(screen.getByText(/loading your board/i)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Ranked players' })).not.toBeInTheDocument();
  });

  it('renders a non-dismissible failure panel naming the problem, mentioning private browsing and any legacy backup', () => {
    act(() => {
      useBoardStore.setState({
        status: 'error',
        bootError: 'OPFS could not be opened: the storage API rejected the request.',
        legacyBackupPresent: true,
      });
    });

    render(<App />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('OPFS could not be opened');
    expect(alert).toHaveTextContent(/private\/incognito browsing/i);
    expect(alert).toHaveTextContent(/no data has been lost/i);
    expect(screen.queryByRole('list', { name: 'Ranked players' })).not.toBeInTheDocument();
  });
});
