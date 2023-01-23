// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol';
import '@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol';
import '@openzeppelin/contracts/security/Pausable.sol';
import '../interfaces/IUnoAccessManager.sol'; 

contract UnoAutoStrategyBanxeFactory is Pausable {
    /**
     * @dev PoolInfo:
     * {assetRouter} - UnoAssetRouter contract.
     * {pool} - Pool address. 
     */
    struct PoolInfo {
        address pool;
        address assetRouter;
    }

    /**
     * @dev Contract Variables:
     * banxe - Banxe account that can make deposits to autostrats.
     * assetRouterApproved - Approved UnoAssetRouter contracts.
     
     * accessManager - Role manager contract.
     * autoStrategyBeacon - AutoStrategy contract implementation.
     * autoStrategies - List of deployed AutoStrategy contracts.
     */

    address public banxe;
    mapping(address => bool) public assetRouterApproved;

    IUnoAccessManager public immutable accessManager;
    address public immutable autoStrategyBeacon;
    address[] public autoStrategies;

    bytes32 private constant PAUSER_ROLE = keccak256('PAUSER_ROLE');
    bytes32 private ADMIN_ROLE;
    
    event AutoStrategyDeployed(address indexed autoStrategy);
    event AssetRouterApproved(address indexed assetRouter);
    event AssetRouterRevoked(address indexed assetRouter);
    event BanxeTransferred(address indexed previousBanxe, address indexed newBanxe);

    modifier onlyRole(bytes32 role){
        require(accessManager.hasRole(role, msg.sender), 'CALLER_NOT_AUTHORIZED');
        _;
    }

    // ============ Methods ============

    constructor (address _implementation, address _accessManager, address[] memory approvedAssetRouters, address _banxe) {
        require (_implementation != address(0), 'BAD_IMPLEMENTATION');
        require (_accessManager != address(0), 'BAD_ACCESS_MANAGER');
        require (_banxe != address(0), "BAD_BANXE_ADDRESS");

        autoStrategyBeacon = address(new UpgradeableBeacon(_implementation));
        accessManager = IUnoAccessManager(_accessManager);

        for (uint256 i = 0; i < approvedAssetRouters.length; i++) {
            assetRouterApproved[approvedAssetRouters[i]] = true;
            emit AssetRouterApproved(approvedAssetRouters[i]);
        }

        banxe = _banxe;
        emit BanxeTransferred(address(0), _banxe);
        
        ADMIN_ROLE = accessManager.ADMIN_ROLE();
    }

    /**
     * @dev Checks if provided assetRouters are approved for use, then deploys new AutoStrategy contract.
     * @param poolInfos - An array of (assetRouter - pool) pairs. AssetRouter needs to be approved for PoolInfo to be valid. poolInfos.length must be >= 2.
     * @return autoStrategy - Deployed Auto Strategy contract address.
     */  
    function createStrategy(PoolInfo[] calldata poolInfos) whenNotPaused external returns (address) {
        for (uint256 i = 0; i < poolInfos.length; i++) {
            require(assetRouterApproved[poolInfos[i].assetRouter] == true, 'ASSET_ROUTER_NOT_APPROVED');
        }
        address autoStrategy = _createStrategy(poolInfos);
        autoStrategies.push(autoStrategy);
        return autoStrategy;
    }

    /**
     * @dev Approves an address for use as an AssetRouter. Emits {AssetRouterApproved} event.
     * @param _assetRouter - Asset router address to approve.

     * Note: This function can only be called by ADMIN_ROLE.
     */  
    function approveAssetRouter(address _assetRouter) external onlyRole(ADMIN_ROLE) {
        require(assetRouterApproved[_assetRouter] == false, 'ASSET_ROUTER_ALREADY_APPROVED');
        assetRouterApproved[_assetRouter] = true;
        emit AssetRouterApproved(_assetRouter);
    }

    /**
     * @dev Revokes Asset Router approval from an address. Emits {AssetRouterRevoked} event.
     * @param _assetRouter - Address to revoke approval from.

     * Note: This function can only be called by ADMIN_ROLE.
     */ 
    function revokeAssetRouter(address _assetRouter) external onlyRole(ADMIN_ROLE) {
        require(assetRouterApproved[_assetRouter] == true, 'ASSET_ROUTER_NOT_APPROVED');
        assetRouterApproved[_assetRouter] = false;
        emit AssetRouterRevoked(_assetRouter);
    }

    /**
     * @dev Upgrade all AutoStrategy contracts to a new implementation using Beacon Proxy.
     * @param newImplementation - New AutoStrategy implementation.

     * Note: This function can only be called by ADMIN_ROLE.
     */ 
    function upgradeStrategies(address newImplementation) external onlyRole(ADMIN_ROLE) {
        UpgradeableBeacon(autoStrategyBeacon).upgradeTo(newImplementation);
    }

    /**
     * @dev Deploys new AutoStrategy contract and calls initialize() on it. Emits {AutoStrategyDeployed} event.
     */
    function _createStrategy(PoolInfo[] calldata poolInfos) internal returns (address) {
        BeaconProxy proxy = new BeaconProxy(
            autoStrategyBeacon,
            abi.encodeWithSelector(
                bytes4(keccak256('initialize((address,address)[],address)')),
                poolInfos,
                accessManager
            )
        );
        emit AutoStrategyDeployed(address(proxy));
        return address(proxy);
    }

    function autoStrategiesLength() external view returns (uint256) {
        return autoStrategies.length;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /**
     * @dev Transfers banxe rights of the contract to a new account (`_banxe`).
     * @param _banxe - Address to transfer banxe rights to.

     * Note: This function can only be called by Banxe.
     */
    function transferBanxe(address _banxe) external {
        require(msg.sender == banxe, "CALLER_NOT_BANXE");
        require(_banxe != address(0), "TRANSFER_TO_ZERO_ADDRESS");
        emit BanxeTransferred(banxe, _banxe);
        banxe = _banxe;
    }
}
