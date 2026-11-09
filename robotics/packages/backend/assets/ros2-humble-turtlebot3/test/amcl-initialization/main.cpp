// Recreate invalid initial state before configure; the installed library must
// initialize pose/covariance before its particle filter consumes either array.
#include <cmath>
#include <iostream>
#include <limits>
#include <memory>
#include <stdexcept>

#include "nav2_amcl/amcl_node.hpp"

class InitializationRegression : public nav2_amcl::AmclNode
{
public:
  void recreate_invalid_initial_state()
  {
    for (int i = 0; i < 3; ++i) {
      init_pose_[i] = std::numeric_limits<double>::quiet_NaN();
      init_cov_[i] = std::numeric_limits<double>::quiet_NaN();
    }
  }

  void verify_initialized_filter()
  {
    const double expected_covariance[] = {0.25, 0.25, std::pow(M_PI / 12.0, 2)};
    for (int i = 0; i < 3; ++i) {
      if (!std::isfinite(init_pose_[i]) || !std::isfinite(init_cov_[i]) ||
        std::abs(init_cov_[i] - expected_covariance[i]) > 1e-12)
      {
        throw std::runtime_error("initial pose/covariance not initialized before filter creation");
      }
    }
    if (pf_ == nullptr) {
      throw std::runtime_error("missing particle filter");
    }
    const auto & particles = pf_->sets[pf_->current_set];
    if (particles.sample_count < 1) {
      throw std::runtime_error("empty particle filter");
    }
    for (int sample = 0; sample < particles.sample_count; ++sample) {
      for (int axis = 0; axis < 3; ++axis) {
        if (!std::isfinite(particles.samples[sample].pose.v[axis])) {
          throw std::runtime_error("nonfinite initialized particle");
        }
      }
    }
    std::cout << "FINITE_PARTICLES " << particles.sample_count << std::endl;
  }
};

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  auto node = std::make_shared<InitializationRegression>();
  node->recreate_invalid_initial_state();
  if (node->configure().label() != "inactive") {
    throw std::runtime_error("configure did not reach inactive state");
  }
  node->verify_initialized_filter();
  node->cleanup();
  node.reset();
  rclcpp::shutdown();
  std::cout << "REGRESSION_PASS" << std::endl;
}
