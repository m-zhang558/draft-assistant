import { render, screen } from '@testing-library/react';
import { LiveRegion } from './live-region';

describe('LiveRegion', () => {
  it('renders the message inside a polite status region by default', () => {
    render(<LiveRegion message="Jahmyr Gibbs marked drafted" />);

    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('Jahmyr Gibbs marked drafted');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
  });

  it('honours an assertive politeness override', () => {
    render(<LiveRegion message="Undo restored the previous order" politeness="assertive" />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'assertive');
  });
});
