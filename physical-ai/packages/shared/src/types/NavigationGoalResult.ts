export interface NavigationGoalResult {
  status: 'accepted' | 'navigating' | 'reached' | 'failed' | 'rejected';
  message: string;
}
