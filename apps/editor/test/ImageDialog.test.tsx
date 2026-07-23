import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageDialog } from '../src/views/files/ImageDialog';

describe('ImageDialog', () => {
  it('collects url + alt + width + height and calls onInsert', () => {
    const onInsert = vi.fn();
    render(<ImageDialog projectId="p" onInsert={onInsert} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Image URL/), { target: { value: 'https://x.test/a.jpg' } });
    fireEvent.change(screen.getByLabelText(/Alt text/), { target: { value: 'A photo' } });
    fireEvent.change(screen.getByLabelText(/^Width/), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText(/^Height/), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(onInsert).toHaveBeenCalledWith({ url: 'https://x.test/a.jpg', alt: 'A photo', width: '300', height: '200' });
  });

  it('disables Insert until a URL is entered, and clamps bad dimensions to empty', () => {
    const onInsert = vi.fn();
    render(<ImageDialog projectId="p" onInsert={onInsert} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Insert' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Image URL/), { target: { value: '/media/x.jpg' } });
    fireEvent.change(screen.getByLabelText(/^Width/), { target: { value: '-5' } }); // invalid → dropped
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(onInsert).toHaveBeenCalledWith({ url: '/media/x.jpg', alt: '', width: '', height: '' });
  });

  it('pre-fills for editing and labels the action "Apply"', () => {
    render(<ImageDialog projectId="p" initial={{ url: '/media/y.jpg', alt: 'Y', width: '120' }} onInsert={() => {}} onClose={() => {}} />);
    expect((screen.getByLabelText(/Image URL/) as HTMLInputElement).value).toBe('/media/y.jpg');
    expect((screen.getByLabelText(/Alt text/) as HTMLInputElement).value).toBe('Y');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
  });

  it('caps a huge typed dimension to the same max as drag-resize (4000)', () => {
    const onInsert = vi.fn();
    render(<ImageDialog projectId="p" onInsert={onInsert} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/Image URL/), { target: { value: '/media/x.jpg' } });
    fireEvent.change(screen.getByLabelText(/^Width/), { target: { value: '99999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(onInsert).toHaveBeenCalledWith({ url: '/media/x.jpg', alt: '', width: '4000', height: '' });
  });
});
