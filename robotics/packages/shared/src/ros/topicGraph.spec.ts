import { describe, expect, it } from 'vitest';
import { parseTopicGraphDiscovery, ROS_TOPIC_GRAPH_DISCOVERY_SCRIPT, ROS_TOPIC_GRAPH_NODE_LIMIT } from './topicGraph';

describe('parseTopicGraphDiscovery', () => {
  it('parses namespaced nodes and pub/sub sections', () => {
    const result = parseTopicGraphDiscovery(
      [
        'N\t/robot_1/controller',
        '  Subscribers:',
        '    /cmd_vel: geometry_msgs/msg/Twist',
        '  Publishers:',
        '    /odom: nav_msgs/msg/Odometry',
        '  Service Servers:',
        '    /controller/describe_parameters: rcl_interfaces/srv/DescribeParameters',
      ].join('\n'),
    );

    expect(result).toEqual([
      {
        nodeName: 'controller',
        nodeNamespace: '/robot_1',
        publishingTopics: ['/odom'],
        subscribingTopics: ['/cmd_vel'],
      },
    ]);
  });

  it('deduplicates topics and ignores malformed or non-topic sections', () => {
    const result = parseTopicGraphDiscovery(
      [
        'N\t/amcl',
        '  Publishers:',
        '    /tf: tf2_msgs/msg/TFMessage',
        '    /tf: tf2_msgs/msg/TFMessage',
        '    not-a-topic: bad',
        '  Subscribers:',
        '    /scan: sensor_msgs/msg/LaserScan',
        'N\t/malformed',
        '  Publishers:',
        '    /map: nav_msgs/msg/OccupancyGrid',
      ].join('\n'),
    );

    expect(result[0]).toMatchObject({ publishingTopics: ['/tf'], subscribingTopics: ['/scan'] });
    expect(result[1]).toMatchObject({ nodeName: 'malformed', publishingTopics: ['/map'] });
  });

  it('caps the parsed node count', () => {
    const output = Array.from({ length: 3 }, (_, index) => `N\t/node_${index}`).join('\n');
    expect(parseTopicGraphDiscovery(output, 2)).toHaveLength(2);
  });

  it('keeps node discovery bounded inside the container', () => {
    expect(ROS_TOPIC_GRAPH_DISCOVERY_SCRIPT).toContain('ros2 node list');
    expect(ROS_TOPIC_GRAPH_DISCOVERY_SCRIPT).toContain('ros2 node info "$node"');
    expect(ROS_TOPIC_GRAPH_DISCOVERY_SCRIPT).toContain(`"$count" -gt ${ROS_TOPIC_GRAPH_NODE_LIMIT}`);
  });
});
