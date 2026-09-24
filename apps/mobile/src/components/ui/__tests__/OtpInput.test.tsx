import { fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { renderWithProviders } from '../../../../test/render';
import { OtpInput } from '../OtpInput';
import { countUpValue } from '../useCountUp';

function Harness({ onComplete }: { onComplete: (v: string) => void }) {
  const [value, setValue] = useState('');
  return <OtpInput value={value} onChange={setValue} onComplete={onComplete} autoFocus={false} />;
}

describe('OtpInput', () => {
  it('fills the boxes digit by digit and fires onComplete exactly once', async () => {
    const onComplete = jest.fn();
    await renderWithProviders(<Harness onComplete={onComplete} />);
    const field = screen.getByTestId('otp-input-field');

    await fireEvent.changeText(field, '12');
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();

    await fireEvent.changeText(field, '123456');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');

    // Re-rendering with the same complete value must not fire again.
    await fireEvent.changeText(field, '123456');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('strips non-digits and caps the length', async () => {
    const onComplete = jest.fn();
    await renderWithProviders(<Harness onComplete={onComplete} />);
    await fireEvent.changeText(screen.getByTestId('otp-input-field'), '12a3-45 6789');
    expect(onComplete).toHaveBeenCalledWith('123456');
    expect(screen.queryByText('7')).toBeNull();
  });

  it('labels every digit box for screen readers', async () => {
    await renderWithProviders(<Harness onComplete={jest.fn()} />);
    expect(screen.getAllByLabelText(/1 ከ6|1 of 6/)).toHaveLength(1);
  });
});

describe('countUpValue', () => {
  it('eases towards the target and lands exactly on it', async () => {
    expect(countUpValue(0, 100, 0, 1000)).toBe(0);
    expect(countUpValue(0, 100, 500, 1000)).toBeGreaterThan(50);
    expect(countUpValue(0, 100, 1000, 1000)).toBe(100);
    expect(countUpValue(0, 100, 5000, 1000)).toBe(100);
    expect(countUpValue(40, 100, 0, 0)).toBe(100);
  });
});
