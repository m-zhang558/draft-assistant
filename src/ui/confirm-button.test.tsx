import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmButton } from './confirm-button';

describe('ConfirmButton', () => {
  it('arms on the first click without firing, then fires on the second click', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(<ConfirmButton label="Reset" confirmLabel="Confirm reset?" onConfirm={onConfirm} />);

    const button = screen.getByRole('button', { name: 'Reset' });
    await user.click(button);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm reset?' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm reset?' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
  });

  it('disarms on Escape without firing onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(<ConfirmButton label="Reset" confirmLabel="Confirm reset?" onConfirm={onConfirm} />);

    const button = screen.getByRole('button', { name: 'Reset' });
    await user.click(button);
    expect(screen.getByRole('button', { name: 'Confirm reset?' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('disarms on blur without firing onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <div>
        <ConfirmButton label="Reset" confirmLabel="Confirm reset?" onConfirm={onConfirm} />
        <button type="button">elsewhere</button>
      </div>
    );

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('button', { name: 'Confirm reset?' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'elsewhere' }));

    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
