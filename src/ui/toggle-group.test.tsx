import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToggleGroup, type ToggleGroupOption } from './toggle-group';

const OPTIONS: ReadonlyArray<ToggleGroupOption> = [
  { value: 'ALL', label: 'All', count: 10 },
  { value: 'QB', label: 'QB', count: 4 },
  { value: 'K', label: 'K', count: 0, disabled: true },
];

describe('ToggleGroup', () => {
  it('renders a radiogroup with a radio per option', () => {
    render(<ToggleGroup label="Position" options={OPTIONS} value="ALL" onChange={vi.fn()} />);

    expect(screen.getByRole('radiogroup', { name: 'Position' })).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'QB' })).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onChange with the clicked option value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ToggleGroup label="Position" options={OPTIONS} value="ALL" onChange={onChange} />);

    await user.click(screen.getByRole('radio', { name: 'QB' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('QB');
  });

  it('renders disabled options as disabled and does not select them on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ToggleGroup label="Position" options={OPTIONS} value="ALL" onChange={onChange} />);

    const kOption = screen.getByRole('radio', { name: 'K' });
    expect(kOption).toBeDisabled();

    await user.click(kOption);

    expect(onChange).not.toHaveBeenCalled();
  });
});
