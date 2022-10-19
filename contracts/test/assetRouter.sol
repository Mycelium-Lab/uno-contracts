// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract AssetRouter is Initializable {
	address public accessManager;
	address public factory;

	function initialize(address _accessManager, address _factory)
		external
		initializer
	{
		require(_accessManager != address(0), "BAD_ACCESS_MANAGER");
		require(_factory != address(0), "BAD_FARM_FACTORY");

		accessManager = _accessManager;
		factory = _factory;
	}
}
