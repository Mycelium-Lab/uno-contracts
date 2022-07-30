// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';

contract FarmV2 is Initializable {
    address public lpStakingPool;
    address public assetRouter;
    uint256 public constant version = 2;

    function initialize(address _lpStakingPool, address _assetRouter) external initializer {
        lpStakingPool = _lpStakingPool;
        assetRouter = _assetRouter;
    }
}
