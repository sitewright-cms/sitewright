import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProjectCaptcha } from '../src/views/ProjectCaptcha';
import type { Project } from '../src/api';

const getProjectCaptcha = vi.fn();
const putProjectCaptcha = vi.fn();
const deleteProjectCaptcha = vi.fn();
const testProjectCaptcha = vi.fn();

vi.mock('../src/api', async (orig) => {
  const actual = await orig<typeof import('../src/api')>();
  return {
    ...actual,
    api: {
      getProjectCaptcha: (...a: unknown[]) => getProjectCaptcha(...a),
      putProjectCaptcha: (...a: unknown[]) => putProjectCaptcha(...a),
      deleteProjectCaptcha: (...a: unknown[]) => deleteProjectCaptcha(...a),
      testProjectCaptcha: (...a: unknown[]) => testProjectCaptcha(...a),
    },
  };
});

const project = { id: 'p1', name: 'Acme', slug: 'acme' } as Project;
const HCAPTCHA_KEY = '10000000-ffff-ffff-ffff-000000000001';
const RECAPTCHA_KEY = '6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI';

const open = async () => fireEvent.click(await screen.findByText(/^Captcha/));

beforeEach(() => {
  vi.clearAllMocks();
  getProjectCaptcha.mockResolvedValue({ captcha: null });
  putProjectCaptcha.mockImplementation((_id: string, body: { provider: string; siteKey: string; secret?: string }) =>
    Promise.resolve({ captcha: { provider: body.provider, siteKey: body.siteKey, hasSecret: Boolean(body.secret) } }),
  );
  deleteProjectCaptcha.mockResolvedValue(undefined);
});

describe('ProjectCaptcha', () => {
  it('saves the provider, key and secret the author entered', async () => {
    render(<ProjectCaptcha project={project} />);
    await open();
    fireEvent.click(await screen.findByLabelText('Configure a captcha for this project'));
    fireEvent.change(screen.getByLabelText('Captcha provider'), { target: { value: 'recaptcha-v2' } });
    fireEvent.change(screen.getByLabelText('Captcha site key'), { target: { value: RECAPTCHA_KEY } });
    fireEvent.change(screen.getByLabelText('Captcha secret key'), { target: { value: 's3cret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putProjectCaptcha).toHaveBeenCalled());
    expect(putProjectCaptcha.mock.calls[0]![1]).toEqual({ provider: 'recaptcha-v2', siteKey: RECAPTCHA_KEY, secret: 's3cret' });
  });

  it('★ warns while the author is still looking at a key that cannot be right', async () => {
    // The whole point of checking the SHAPE is to catch a placeholder before it is saved — an
    // instance once shipped `data-sitekey="123"` to every visitor because nothing said anything.
    render(<ProjectCaptcha project={project} />);
    await open();
    fireEvent.click(await screen.findByLabelText('Configure a captcha for this project'));
    fireEvent.change(screen.getByLabelText('Captcha site key'), { target: { value: '123' } });
    expect(screen.getByText(/does not look like a/i)).toBeInTheDocument();
    // …and it clears once the value is plausible, rather than nagging forever.
    fireEvent.change(screen.getByLabelText('Captcha site key'), { target: { value: HCAPTCHA_KEY } });
    expect(screen.queryByText(/does not look like a/i)).not.toBeInTheDocument();
  });

  it('warns that a key pasted for the WRONG provider is wrong', async () => {
    render(<ProjectCaptcha project={project} />);
    await open();
    fireEvent.click(await screen.findByLabelText('Configure a captcha for this project'));
    fireEvent.change(screen.getByLabelText('Captcha site key'), { target: { value: RECAPTCHA_KEY } });
    expect(screen.getByText(/does not look like a/i)).toBeInTheDocument(); // provider still hCaptcha
    fireEvent.change(screen.getByLabelText('Captcha provider'), { target: { value: 'recaptcha-v2' } });
    expect(screen.queryByText(/does not look like a/i)).not.toBeInTheDocument();
  });

  it('★ says plainly that Google’s options need consent, where the choice is made', async () => {
    // reCAPTCHA has to sit behind the Consent Manager in the EU, and a visitor who declines cannot
    // submit at all. An author picking it deserves to know that before a client's leads dry up.
    render(<ProjectCaptcha project={project} />);
    await open();
    fireEvent.click(await screen.findByLabelText('Configure a captcha for this project'));
    expect(screen.queryByText(/sends visitor data to Google/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Captcha provider'), { target: { value: 'recaptcha-v3' } });
    expect(screen.getByText(/sends visitor data to Google/i)).toBeInTheDocument();
  });

  it('offers the score threshold for v3 only, and sends it', async () => {
    render(<ProjectCaptcha project={project} />);
    await open();
    fireEvent.click(await screen.findByLabelText('Configure a captcha for this project'));
    expect(screen.queryByLabelText('reCAPTCHA v3 minimum score')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Captcha provider'), { target: { value: 'recaptcha-v3' } });
    fireEvent.change(screen.getByLabelText('Captcha site key'), { target: { value: RECAPTCHA_KEY } });
    fireEvent.change(screen.getByLabelText('reCAPTCHA v3 minimum score'), { target: { value: '0.8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putProjectCaptcha).toHaveBeenCalled());
    expect(putProjectCaptcha.mock.calls[0]![1]).toMatchObject({ provider: 'recaptcha-v3', minScore: 0.8 });
  });

  it('keeps a stored secret when the field is left blank', async () => {
    getProjectCaptcha.mockResolvedValue({ captcha: { provider: 'hcaptcha', siteKey: HCAPTCHA_KEY, hasSecret: true } });
    render(<ProjectCaptcha project={project} />);
    await open();
    await screen.findByLabelText('Captcha site key');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putProjectCaptcha).toHaveBeenCalled());
    expect(putProjectCaptcha.mock.calls[0]![1]).not.toHaveProperty('secret');
  });

  it('warns when there is no secret at all, because every submission would be rejected', async () => {
    render(<ProjectCaptcha project={project} />);
    await open();
    fireEvent.click(await screen.findByLabelText('Configure a captcha for this project'));
    expect(screen.getByText(/cannot verify a solve/i)).toBeInTheDocument();
  });

  it('DELETES the config when the author turns the captcha off', async () => {
    getProjectCaptcha.mockResolvedValue({ captcha: { provider: 'hcaptcha', siteKey: HCAPTCHA_KEY, hasSecret: true } });
    render(<ProjectCaptcha project={project} />);
    await open();
    fireEvent.click(await screen.findByLabelText('Configure a captcha for this project'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(deleteProjectCaptcha).toHaveBeenCalledWith('p1'));
    expect(putProjectCaptcha).not.toHaveBeenCalled();
  });

  it('reports what the provider said about the stored credentials', async () => {
    getProjectCaptcha.mockResolvedValue({ captcha: { provider: 'hcaptcha', siteKey: HCAPTCHA_KEY, hasSecret: true } });
    testProjectCaptcha.mockResolvedValue({ ok: false, error: 'The provider rejected the secret key.' });
    render(<ProjectCaptcha project={project} />);
    await open();
    fireEvent.click(await screen.findByRole('button', { name: 'Test credentials' }));
    expect(await screen.findByText(/rejected the secret key/i)).toBeInTheDocument();
  });

  it('surfaces a load failure instead of rendering an empty form', async () => {
    getProjectCaptcha.mockRejectedValue(new Error('403 forbidden'));
    render(<ProjectCaptcha project={project} />);
    await open();
    expect(await screen.findByText('403 forbidden')).toBeInTheDocument();
  });

  it('surfaces a save failure', async () => {
    putProjectCaptcha.mockRejectedValue(new Error('site key is invalid'));
    render(<ProjectCaptcha project={project} />);
    await open();
    fireEvent.click(await screen.findByLabelText('Configure a captcha for this project'));
    fireEvent.change(screen.getByLabelText('Captcha site key'), { target: { value: HCAPTCHA_KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('site key is invalid')).toBeInTheDocument();
  });
});
