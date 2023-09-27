// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract Farm is Initializable {
	address public lpStakingPool;
	address public assetRouter;
	uint256 public constant version = 1;

	function initialize(address _lpStakingPool, address _assetRouter)
		external
		initializer
	{
		require(_lpStakingPool != address(0), "BAD_LP_POOL");
		require(_assetRouter != address(0), "BAD_ASSET_ROUTER");

		lpStakingPool = _lpStakingPool;
		assetRouter = _assetRouter;
	}
}
