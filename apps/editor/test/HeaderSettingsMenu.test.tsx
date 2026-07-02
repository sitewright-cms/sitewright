import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HeaderSettingsMenu } from '../src/views/HeaderSettingsMenu';

function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
}

const baseProps = {
  inProject: true,
  isClient: false,
  isInstanceAdmin: false,
  onPublishDeploy: vi.fn(),
  onSystemSettings: vi.fn(),
  onClients: vi.fn(),
  onTeam: vi.fn(),
};

describe('HeaderSettingsMenu — Export project', () => {
  it('shows "Export project (.zip)" for any member and fires the handler', () => {
    const onExportProject = vi.fn();
    render(<HeaderSettingsMenu {...baseProps} isClient onExportProject={onExportProject} />);
    open();
    const item = screen.getByRole('menuitem', { name: 'Export project (.zip)' });
    fireEvent.click(item);
    expect(onExportProject).toHaveBeenCalledTimes(1);
  });

  it('hides the item when no export handler is provided', () => {
    render(<HeaderSettingsMenu {...baseProps} />);
    open();
    expect(screen.queryByRole('menuitem', { name: 'Export project (.zip)' })).toBeNull();
  });

  it('hides the item when no project is open', () => {
    const onExportProject = vi.fn();
    render(
      <HeaderSettingsMenu
        {...baseProps}
        inProject={false}
        isInstanceAdmin
        onExportProject={onExportProject}
      />,
    );
    open();
    expect(screen.queryByRole('menuitem', { name: 'Export project (.zip)' })).toBeNull();
  });

  it('shows "Duplicate project" when the staff handler is provided, and fires it', () => {
    const onDuplicateProject = vi.fn();
    render(<HeaderSettingsMenu {...baseProps} onDuplicateProject={onDuplicateProject} />);
    open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate project' }));
    expect(onDuplicateProject).toHaveBeenCalledTimes(1);
  });

  it('hides "Duplicate project" for non-staff (no handler passed)', () => {
    render(<HeaderSettingsMenu {...baseProps} />);
    open();
    expect(screen.queryByRole('menuitem', { name: 'Duplicate project' })).toBeNull();
  });
});
