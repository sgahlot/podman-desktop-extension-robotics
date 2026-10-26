<script lang="ts">
import {
  CUSTOM_LAUNCH_PROFILE_ID,
  customLaunchSelection,
  defaultRobotProfileSelection,
  type ImageRobotProfile,
  type RobotProfileSelection,
} from '/@shared/src/types/ImageRobotProfile';

export let profiles: ImageRobotProfile[] = [];
export let selection: RobotProfileSelection | undefined = undefined;
export let idPrefix = 'robot-profile';

$: selectedProfile = profiles.find(profile => profile.id === selection?.profileId);

function selectProfile(profileId: string) {
  if (profileId === CUSTOM_LAUNCH_PROFILE_ID) {
    selection = customLaunchSelection(true);
    return;
  }
  const profile = profiles.find(candidate => candidate.id === profileId);
  if (profile) selection = defaultRobotProfileSelection(profile);
}

function edit(field: 'packageName' | 'launchFile' | 'launchArguments', value: string) {
  if (!selection) return;
  selection = { ...selection, [field]: value, customized: true };
}

function resetProfile() {
  if (selectedProfile) selection = defaultRobotProfileSelection(selectedProfile);
}
</script>

<div class="flex flex-col gap-2 max-w-lg">
  <label for={`${idPrefix}-profile`} class="text-xs pai-text-muted">Robot profile in this image</label>
  <select
    id={`${idPrefix}-profile`}
    value={selection?.profileId ?? CUSTOM_LAUNCH_PROFILE_ID}
    on:change={event => selectProfile(event.currentTarget.value)}
    class="px-2 py-1 text-xs rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)]">
    {#each profiles as profile (profile.id)}
      <option value={profile.id}
        >{profile.displayName}{selection?.profileId === profile.id && selection.customized
          ? ' (customized)'
          : ''}</option>
    {/each}
    <option value={CUSTOM_LAUNCH_PROFILE_ID}>Custom launch configuration</option>
  </select>

  {#if selectedProfile?.kind === 'embedded-sdf'}
    <p class="text-xs pai-text-muted">
      {selectedProfile.displayName} is embedded in this image. The built-in spawn uses X, Y, and yaw below. Editing its ROS
      launch settings switches to launch-based spawning.
    </p>
  {/if}
  {#if selectedProfile && selection?.customized}
    <div class="flex items-center gap-2 text-xs pai-text-muted">
      <span>Customized from {selectedProfile.displayName}.</span>
      <button class="pai-btn pai-btn-sm" on:click={resetProfile}>Reset profile defaults</button>
    </div>
  {/if}
  {#if profiles.length === 0}
    <p class="text-xs pai-text-muted">No bundled robot profiles were found. Enter a launch available in this image.</p>
  {/if}
  <label for={`${idPrefix}-package`} class="text-xs pai-text-muted">ROS package</label>
  <input
    id={`${idPrefix}-package`}
    value={selection?.packageName ?? ''}
    on:input={event => edit('packageName', event.currentTarget.value)}
    placeholder="my_robot_gazebo"
    class="px-2 py-1 text-xs rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)] font-mono" />
  <label for={`${idPrefix}-launch`} class="text-xs pai-text-muted">Launch file</label>
  <input
    id={`${idPrefix}-launch`}
    value={selection?.launchFile ?? ''}
    on:input={event => edit('launchFile', event.currentTarget.value)}
    placeholder="launch/spawn.launch.py"
    class="px-2 py-1 text-xs rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)] font-mono" />
  <label for={`${idPrefix}-arguments`} class="text-xs pai-text-muted"
    >Launch arguments (one <span class="font-mono">name:=value</span> per line)</label>
  <textarea
    id={`${idPrefix}-arguments`}
    value={selection?.launchArguments ?? ''}
    on:input={event => edit('launchArguments', event.currentTarget.value)}
    rows="5"
    class="px-2 py-1 text-xs rounded border border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)] text-[var(--pd-content-text)] font-mono"
  ></textarea>
  <p class="text-xs pai-text-muted">
    Package and launch file must exist in this image. {'{name}'}, {'{x}'}, {'{y}'}, and {'{yaw}'} are substituted in arguments.
  </p>
</div>
