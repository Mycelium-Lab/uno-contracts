// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import '../../../interfaces/IUnoFarmFactory.sol';
import '../../../interfaces/IUnoAccessManager.sol'; 
import '../../../interfaces/IVault.sol'; 

interface IUnoAssetRouterBalancer {
    event Deposit(address indexed lpPool, address indexed from, address indexed recipient, uint256 amount);
    event Withdraw(address indexed lpPool, address indexed from, address indexed recipient, uint256 amount);
    event Distribute(address indexed lpPool, uint256 reward);

    function farmFactory() external view returns(IUnoFarmFactory);
    function accessManager() external view returns(IUnoAccessManager);

    function initialize(address _accessManager, address _farmFactory) external;

    function deposit(address lpPool, uint256[] memory amounts, address[] memory tokens, uint256 amountLP, address recipient) external returns(uint256 liquidity);
    function withdraw(address lpPool, uint256 amount, bool withdrawLP, address recipient) external;

    function distribute(
      address lpPool,
      IVault.BatchSwapStep[][] memory swaps,
      IAsset[][] memory assets,
      int256[][] memory limits
    ) external;

   
    function userStake(address _address, address lpPool) external view returns(uint256);
    function totalDeposits(address lpPool) external view returns (uint256);

    function paused() external view returns(bool);
    function pause() external;
    function unpause() external;

    function upgradeTo(address newImplementation) external;
}
