// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

import '@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol';
import '@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol';
import './interfaces/IUnoAccessManager.sol'; 
import './interfaces/IUnoAssetRouter.sol';

contract UnoFarmFactory{
    /**
     * @dev Contract Variables:
     * farmBeacon - Farm contract implementation.
     * Farms - links {lpPools} to the deployed Farm contract.
     * lpPools - list of pools that have corresponding deployed Farm contract.
     */
    IUnoAccessManager public accessManager;
    address public assetRouter;

    address public farmBeacon;
    mapping(address => address) public Farms;
    address[] public pools;

    event FarmDeployed(address indexed farmAddress);

    // ============ Methods ============

    constructor (address _implementation, address _accessManager, address _assetRouter) {
        farmBeacon = address(new UpgradeableBeacon(_implementation));
        accessManager = IUnoAccessManager(_accessManager);
        assetRouter = _assetRouter;
        IUnoAssetRouter(_assetRouter).initialize(_accessManager, address(this)); 
    }

    function createFarm(address pool) external returns (address) {
        require(Farms[pool] == address(0), 'FARM_EXISTS');
        Farms[pool] = _createFarm(pool);
        pools.push(pool);
        return Farms[pool];
    }

    function upgradeFarms(address newImplementation) external {
        require(accessManager.hasRole(accessManager.ADMIN_ROLE(), msg.sender), 'CALLER_NOT_ADMIN');
        UpgradeableBeacon(farmBeacon).upgradeTo(newImplementation);
    }

    /**
     * @dev Deploys new Farm contract and calls initialize on it. Emits a {FarmDeployed} event.
     */
    function _createFarm(address _pool) internal returns (address) {
        BeaconProxy proxy = new BeaconProxy(
            farmBeacon,
            abi.encodeWithSelector(
                bytes4(keccak256('initialize(address,address)')),
                _pool,
                assetRouter
            )
        );
        emit FarmDeployed(address(proxy));
        return address(proxy);
    }

    function poolLength() external view returns (uint256) {
        return pools.length;
    }
}