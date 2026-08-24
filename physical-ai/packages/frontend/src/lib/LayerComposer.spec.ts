import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import LayerComposer from './LayerComposer.svelte';

// LayerComposer (and the BuildPushPanel it embeds) reach the backend via the RPC client,
// which calls acquirePodmanDesktopApi() at module load — undefined under jsdom. Mock the
// whole client so the component mounts; the wizard's own logic (verdict, preview, build
// mode) is pure and doesn't depend on real backend responses.
const mockGetDefaultNamespace = vi.fn();
const mockGetHostArch = vi.fn();
const mockListLocalImages = vi.fn();
const mockPullImageByRef = vi.fn();
const mockGetPullProgress = vi.fn();
const mockBuildBaseImage = vi.fn();
const mockBuildSimulationImage = vi.fn();
const mockBuildFromContainerfile = vi.fn();
const mockGetImageTags = vi.fn();
const mockGetBuildProgress = vi.fn();
const mockCancelBuild = vi.fn();
const mockPushImage = vi.fn();
const mockCancelPush = vi.fn();
const mockGetPushProgress = vi.fn();

vi.mock('../api/client', () => ({
  physicalAiClient: {
    getDefaultNamespace: (...args: unknown[]) => mockGetDefaultNamespace(...args),
    getHostArch: (...args: unknown[]) => mockGetHostArch(...args),
    listLocalImages: (...args: unknown[]) => mockListLocalImages(...args),
    pullImageByRef: (...args: unknown[]) => mockPullImageByRef(...args),
    getPullProgress: (...args: unknown[]) => mockGetPullProgress(...args),
    buildBaseImage: (...args: unknown[]) => mockBuildBaseImage(...args),
    buildSimulationImage: (...args: unknown[]) => mockBuildSimulationImage(...args),
    buildFromContainerfile: (...args: unknown[]) => mockBuildFromContainerfile(...args),
    getImageTags: (...args: unknown[]) => mockGetImageTags(...args),
    getBuildProgress: (...args: unknown[]) => mockGetBuildProgress(...args),
    cancelBuild: (...args: unknown[]) => mockCancelBuild(...args),
    pushImage: (...args: unknown[]) => mockPushImage(...args),
    cancelPush: (...args: unknown[]) => mockCancelPush(...args),
    getPushProgress: (...args: unknown[]) => mockGetPushProgress(...args),
  },
}));

describe('LayerComposer', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetDefaultNamespace.mockResolvedValue('testns');
    mockGetHostArch.mockResolvedValue('amd64');
    mockListLocalImages.mockResolvedValue([]);
    mockGetImageTags.mockResolvedValue([]);
    mockGetBuildProgress.mockResolvedValue(undefined);
    mockGetPushProgress.mockResolvedValue(undefined);
    mockGetPullProgress.mockResolvedValue(undefined);
  });

  it('renders all 4 picker labels and opens with the success banner (known-good default)', () => {
    render(LayerComposer);
    expect(screen.getByLabelText('Base OS')).toBeTruthy();
    expect(screen.getByLabelText('Hardened app')).toBeTruthy();
    expect(screen.getByLabelText('ROS')).toBeTruthy();
    expect(screen.getByLabelText('Simulation')).toBeTruthy();

    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('Ready — builds and runs today');
  });

  it('selecting a bootc base with ROS produces the error banner text and disables the Build button', async () => {
    render(LayerComposer);
    const baseOsSelect = screen.getByLabelText('Base OS');
    await fireEvent.change(baseOsSelect, { target: { value: 'centos-bootc-stream9' } });

    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain("Won't build");
    expect(banner.textContent).toContain('ROS install step');

    // A blocked stack falls to the generated-Containerfile build path; its single Build
    // button is disabled until "Attempt anyway" is checked.
    const buildButton = screen.getByRole('button', { name: 'Build' });
    expect((buildButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('checking "Attempt anyway" re-enables the Build button while blocked', async () => {
    render(LayerComposer);
    const baseOsSelect = screen.getByLabelText('Base OS');
    await fireEvent.change(baseOsSelect, { target: { value: 'centos-bootc-stream9' } });

    const buildButton = screen.getByRole('button', { name: 'Build' }) as HTMLButtonElement;
    expect(buildButton.disabled).toBe(true);

    const attemptAnyway = screen.getByLabelText(/Attempt anyway/);
    await fireEvent.click(attemptAnyway);

    expect(buildButton.disabled).toBe(false);
  });

  it('the Containerfile preview reflects a selection change', async () => {
    render(LayerComposer);
    const baseOsSelect = screen.getByLabelText('Base OS');
    await fireEvent.change(baseOsSelect, { target: { value: 'centos-bootc-stream9' } });

    expect(document.body.textContent).toContain('quay.io/centos-bootc/centos-bootc:stream9');
  });

  it('Hummingbird app checkboxes are absent by default and appear after selecting Hardened=Hummingbird', async () => {
    render(LayerComposer);
    expect(screen.queryByText('Nginx')).toBeNull();

    const hardenedSelect = screen.getByLabelText('Hardened app');
    await fireEvent.change(hardenedSelect, { target: { value: 'hummingbird-app' } });

    expect(screen.getByText('Nginx')).toBeTruthy();
  });

  it('checking a companion app makes the Containerfile preview contain its hummingbird image ref', async () => {
    render(LayerComposer);
    const hardenedSelect = screen.getByLabelText('Hardened app');
    await fireEvent.change(hardenedSelect, { target: { value: 'hummingbird-app' } });

    const nginxCheckbox = screen.getByText('Nginx').closest('label')?.querySelector('input[type="checkbox"]');
    expect(nginxCheckbox).toBeTruthy();
    await fireEvent.click(nginxCheckbox as HTMLInputElement);

    expect(document.body.textContent).toContain('quay.io/hummingbird/nginx');
  });

  it('selecting a new bootc base (CentOS Stream 10) updates the preview FROM ref', async () => {
    render(LayerComposer);
    const baseOsSelect = screen.getByLabelText('Base OS');
    await fireEvent.change(baseOsSelect, { target: { value: 'centos-bootc-stream10' } });

    expect(document.body.textContent).toContain('quay.io/centos-bootc/centos-bootc:stream10');
  });
});
