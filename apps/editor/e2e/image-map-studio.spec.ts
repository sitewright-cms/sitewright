import { test, expect } from '@playwright/test';

const stamp = Date.now();

// A valid 160×90 PNG. Its DIMENSIONS are the point: dropping it must size the artboard to 160×90,
// because an artboard shaped differently from its background stretches every hotspot drawn on it.
const PNG_160X90 =
  'iVBORw0KGgoAAAANSUhEUgAAAKAAAABaCAIAAACwpMoFAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAoklEQVR42u3RMQ0AAAgEsfevjJkZMfiAJqfgmurR4WIBYAEWYAEWYAEWYMACLMACLMACLMCABViABViABViABRiwAAuwAAuwAAswYAEWYAEWYAEWYMACLMACLMACLMACDFiABViABViABRiwAAuwAAuwAAswYBcAC7AAC7AAC7AAAxZgARZgARZgAQYswAIswAIswAIswIAFWIAFWIAFWIB/tYYkdZd+ETeiAAAAAElFTkSuQmCC';

// THE CORE IMAGE-MAP WORKFLOW, which is the one people actually use: bring in your own image, then
// trace the outline of something in it so that part of the picture becomes clickable. Everything
// else the Studio does (templates, tooltips, floors) hangs off this.
test('image map studio: drop an image in, trace a polygon over it, and have it survive a save', async ({ page }) => {
  // Signs IN as the seeded admin rather than registering a throwaway user: registration is
  // invitation-only (there is no self-registration toggle any more), so a fresh slot has no way to
  // create one from the UI.
  await page.goto('/');
  await page.getByLabel('Email').fill('admin@e2e.test');
  await page.getByRole('textbox', { name: 'Password' }).fill('Pw-secret-1');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const slug = `imap-${stamp}`;
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Hotspot Site');
  await page.getByLabel('Project slug').fill(slug);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('button', { name: 'Open System Library' }).click();
  await page.getByRole('button', { name: /Image map studio/ }).click();
  const studio = page.getByRole('dialog', { name: /Image Map/ });
  await studio.getByRole('button', { name: 'New map' }).first().click();

  // --- The image goes in first, and the canvas says so rather than showing a blank grey box ---
  await expect(studio.getByText(/Start with the image you want to make interactive/)).toBeVisible();

  const artboard = studio.getByTestId('imap-artboard');
  await artboard.evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'floorplan.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    // The drop lands on the scroll pane that wraps the artboard, which is where the handler sits.
    el.parentElement!.parentElement!.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  }, PNG_160X90);

  // The toast renders at the app root, not inside the Studio dialog.
  await expect(page.getByText(/added to your library/)).toBeVisible();
  await expect(studio.getByText(/Start with the image/)).toHaveCount(0);
  // ★ The artboard took the image's OWN size. Without this the Studio and the published page lay
  // hotspots out in different shapes, and everything the author traces lands somewhere else.
  await expect(studio.getByText('160 × 90')).toBeVisible();

  // --- Trace a polygon: a vertex per click, closed with Enter ---
  await studio.getByRole('button', { name: 'Polygon' }).click();
  await expect(studio.getByText(/Click along the outline/)).toBeVisible();

  const box = (await artboard.boundingBox())!;
  const outline = [
    [0.2, 0.3],
    [0.55, 0.22],
    [0.7, 0.6],
    [0.45, 0.78],
    [0.18, 0.62],
  ] as const;
  for (const [fx, fy] of outline) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  }
  await expect(studio.getByText(/5 points/)).toBeVisible();
  await page.keyboard.press('Enter');

  // The hotspot exists, with all five of its points — not the three of a stamped triangle.
  await expect(studio.getByRole('button', { name: 'Polygon 1' }).first()).toBeVisible();
  await expect(studio.getByLabel(/^Point /)).toHaveCount(0); // the tool is still in hand, handles hidden
  await studio.getByRole('button', { name: 'Polygon', exact: true }).click(); // put the tool down
  await studio.getByRole('button', { name: 'Polygon 1' }).first().click();
  await expect(studio.getByLabel(/^Point /)).toHaveCount(5);

  await studio.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Map saved')).toBeVisible();

  // --- What was saved: five vertices, and an artboard the size of the image ---
  // Content routes key on the project's internal id, not its slug.
  const projectId = await page.evaluate(async (want) => {
    const res = await fetch('/projects', { credentials: 'include' });
    const body = (await res.json()) as { projects?: Array<{ id: string; slug: string }> };
    return (body.projects ?? []).find((p) => p.slug === want)?.id ?? '';
  }, slug);
  expect(projectId).toBeTruthy();
  const saved = await page.request.get(`/projects/${projectId}/content/imagemap`);
  expect(saved.ok()).toBeTruthy();
  const { items } = (await saved.json()) as {
    items: Array<{ id: string; artboards: Array<{ width?: number; height?: number; children?: Array<{ type?: string; points?: unknown[] }> }> }>;
  };
  expect(items).toHaveLength(1);
  const board = items[0]!.artboards[0]!;
  expect({ width: board.width, height: board.height }).toEqual({ width: 160, height: 90 });
  const hotspot = board.children!.find((c) => c.type === 'poly')!;
  expect(hotspot.points).toHaveLength(5);

  // --- And it survives the round trip: reopened, the trace is still the shape that was drawn ---
  // (That this geometry then RENDERS where it was traced is measured separately, against the real
  // runtime, rather than asserted through the editor.)
  await studio.getByRole('button', { name: '← All maps' }).click();
  await studio.getByRole('button', { name: /^Untitled map/ }).first().click();
  await expect(studio.getByText('160 × 90')).toBeVisible();
  await studio.getByRole('button', { name: 'Polygon 1' }).first().click();
  await expect(studio.getByLabel(/^Point /)).toHaveCount(5);
});
