/**
 * A ROS launch file that is already installed in the selected simulation image.
 * Values are passed to `ros2 launch` as argv, never through a shell.
 */
export interface RobotLaunch {
  packageName: string;
  launchFile: string;
  arguments: string[];
}
