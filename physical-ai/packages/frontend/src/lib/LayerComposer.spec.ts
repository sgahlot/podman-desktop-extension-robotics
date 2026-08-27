import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import LayerComposer from './LayerComposer.svelte';

// LayerComposer (and the BuildPushPanel it embeds) reach the backend via the RPC client,
// which calls acquirePodmanDesktopApi() at module load — undefined under jsdom. Mock the
// whole client so the component mounts; the wizard's own logic (verdict, preview, build
// mode) is pure and doesn't depend on real backend responses.
const mockGetDefaultNamespace = vi.fn();
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

  it('selecting the syft tool passes generateSbom: true to buildFromContainerfile on build', async () => {
    mockBuildFromContainerfile.mockResolvedValue(undefined);
    render(LayerComposer);
    const hardenedSelect = screen.getByLabelText('Hardened app');
    await fireEvent.change(hardenedSelect, { target: { value: 'hummingbird-app' } });

    const syftCheckbox = screen.getByText('Syft').closest('label')?.querySelector('input[type="checkbox"]');
    expect(syftCheckbox).toBeTruthy();
    await fireEvent.click(syftCheckbox as HTMLInputElement);

    const buildButton = screen.getByRole('button', { name: 'Build' });
    await fireEvent.click(buildButton);

    await waitFor(() => {
      expect(mockBuildFromContainerfile).toHaveBeenCalledWith(expect.any(String), expect.any(String), undefined, {
        generateSbom: true,
        sbomFormat: 'cyclonedx-json',
      });
    });
  });

  it('building without syft selected passes generateSbom: false', async () => {
    mockBuildFromContainerfile.mockResolvedValue(undefined);
    render(LayerComposer);
    const hardenedSelect = screen.getByLabelText('Hardened app');
    await fireEvent.change(hardenedSelect, { target: { value: 'hummingbird-app' } });

    const cosignCheckbox = screen.getByText('Cosign').closest('label')?.querySelector('input[type="checkbox"]');
    expect(cosignCheckbox).toBeTruthy();
    await fireEvent.click(cosignCheckbox as HTMLInputElement);

    const buildButton = screen.getByRole('button', { name: 'Build' });
    await fireEvent.click(buildButton);

    await waitFor(() => {
      expect(mockBuildFromContainerfile).toHaveBeenCalledWith(expect.any(String), expect.any(String), undefined, {
        generateSbom: false,
        sbomFormat: 'cyclonedx-json',
      });
    });
  });

  it('only shows the SBOM format picker once syft is selected, defaulting to CycloneDX', async () => {
    render(LayerComposer);
    const hardenedSelect = screen.getByLabelText('Hardened app');
    await fireEvent.change(hardenedSelect, { target: { value: 'hummingbird-app' } });

    expect(screen.queryByRole('radiogroup', { name: 'SBOM format' })).toBeNull();

    const syftCheckbox = screen.getByText('Syft').closest('label')?.querySelector('input[type="checkbox"]');
    await fireEvent.click(syftCheckbox as HTMLInputElement);

    const cyclonedxRadio = screen.getByRole('radio', { name: /CycloneDX/ }) as HTMLInputElement;
    const spdxRadio = screen.getByRole('radio', { name: /^SPDX\b/ }) as HTMLInputElement;
    expect(cyclonedxRadio.checked).toBe(true);
    expect(spdxRadio.checked).toBe(false);
  });

  it('selecting SPDX passes sbomFormat: "spdx-json" to buildFromContainerfile on build', async () => {
    mockBuildFromContainerfile.mockResolvedValue(undefined);
    render(LayerComposer);
    const hardenedSelect = screen.getByLabelText('Hardened app');
    await fireEvent.change(hardenedSelect, { target: { value: 'hummingbird-app' } });

    const syftCheckbox = screen.getByText('Syft').closest('label')?.querySelector('input[type="checkbox"]');
    await fireEvent.click(syftCheckbox as HTMLInputElement);

    const spdxRadio = screen.getByRole('radio', { name: /^SPDX\b/ });
    await fireEvent.click(spdxRadio);

    const buildButton = screen.getByRole('button', { name: 'Build' });
    await fireEvent.click(buildButton);

    await waitFor(() => {
      expect(mockBuildFromContainerfile).toHaveBeenCalledWith(expect.any(String), expect.any(String), undefined, {
        generateSbom: true,
        sbomFormat: 'spdx-json',
      });
    });
  });

  it('selecting a new bootc base (CentOS Stream 10) updates the preview FROM ref', async () => {
    render(LayerComposer);
    const baseOsSelect = screen.getByLabelText('Base OS');
    await fireEvent.change(baseOsSelect, { target: { value: 'centos-bootc-stream10' } });

    expect(document.body.textContent).toContain('quay.io/centos-bootc/centos-bootc:stream10');
  });

  // APPENG-6241: the Target toggle used to have zero effect in Layers mode — targetArch is
  // now owned by the parent (SimulationSetup) and passed in as a prop, not fetched locally.
  // Each test switches Base OS to a non-preset value first (forces the single-panel
  // "containerfile" build mode) — the default ubuntu-noble/jazzy/gazebo selection is a
  // "preset" stack, which renders two separate Build buttons/tag inputs (Step 1 + Step 2),
  // making a bare getByRole('button', { name: 'Build' }) ambiguous.
  describe('cross-arch target (APPENG-6241)', () => {
    async function switchToContainerfileMode() {
      const baseOsSelect = screen.getByLabelText('Base OS');
      await fireEvent.change(baseOsSelect, { target: { value: 'centos-bootc-stream9' } });
    }

    it('tags the build with the target arch suffix and shows a cross-build note when it differs from the host', async () => {
      render(LayerComposer, { props: { targetArch: 'amd64', hostArch: 'arm64' } });
      await switchToContainerfileMode();

      const tagInput = screen.getByLabelText('Image tag') as HTMLInputElement;
      expect(tagInput.value).toContain('-amd64');
      expect(document.body.textContent).toContain('cross-building via QEMU on this arm64 host');
    });

    it('does not show a cross-build note when the target matches the host, and the tag has no suffix', async () => {
      render(LayerComposer, { props: { targetArch: 'arm64', hostArch: 'arm64' } });
      await switchToContainerfileMode();

      const tagInput = screen.getByLabelText('Image tag') as HTMLInputElement;
      expect(tagInput.value).not.toContain('-amd64');
      expect(document.body.textContent).not.toContain('cross-building via QEMU');
    });

    it('passes the real platform (not undefined) to buildFromContainerfile when targeting amd64', async () => {
      mockBuildFromContainerfile.mockResolvedValue(undefined);
      render(LayerComposer, { props: { targetArch: 'amd64', hostArch: 'arm64' } });
      await switchToContainerfileMode();

      const attemptAnyway = screen.getByLabelText(/Attempt anyway/);
      await fireEvent.click(attemptAnyway);
      const buildButton = screen.getByRole('button', { name: 'Build' });
      await fireEvent.click(buildButton);

      await waitFor(() => {
        expect(mockBuildFromContainerfile).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'linux/amd64', {
          generateSbom: false,
          sbomFormat: 'cyclonedx-json',
        });
      });
    });
  });
});
