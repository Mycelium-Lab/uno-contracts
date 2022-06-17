// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IUnoAssetRouterBalancer {
    event Deposit(address indexed lpPool, address indexed from, address indexed recipient, uint256 amount);
    event Withdraw(address indexed lpPool, address indexed from, address indexed recipient, uint256 amount);
    event Distribute(address indexed lpPool, uint256 reward);

    function farmFactory() external view returns(address);
    function accessManager() external view returns(address);

    function initialize(address _accessManager, address _farmFactory) external;

    function deposit(address lpPool, uint256[] memory amounts, IERC20[] memory tokens, uint256 minAmountLP, uint256 amountLP, address recipient) external returns(uint256 liquidity);
    function withdraw(address lpPool, uint256 amount, uint256[] calldata minAmountsOut, bool withdrawLP, address recipient) external;
   
    function userStake(address _address, address lpPool) external view returns(uint256);
    function totalDeposits(address lpPool) external view returns (uint256);
    function getTokens(address lpPool) external view returns(IERC20[] memory tokens);

    function paused() external view returns(bool);
    function pause() external;
    function unpause() external;

    function upgradeTo(address newImplementation) external;
}
