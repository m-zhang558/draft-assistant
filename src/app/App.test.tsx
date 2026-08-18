import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the app title and the loaded redraft PPR dataset', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'Fantasy Assist' })).toBeInTheDocument();
    expect(screen.getByText(/Redraft PPR — 426 players/)).toBeInTheDocument();
    expect(screen.getByText('Flock Fantasy')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    // 1 header row + 426 player rows
    expect(screen.getAllByRole('row')).toHaveLength(427);
  });
});
