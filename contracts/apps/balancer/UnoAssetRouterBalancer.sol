// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

import {IUnoFarmBalancer as Farm} from './interfaces/IUnoFarmBalancer.sol'; 
import '../../interfaces/IUnoFarmFactory.sol';
import '../../interfaces/IUnoAccessManager.sol'; 
import '../../interfaces/MerkleOrchard.sol'; 
import '../../interfaces/IVault.sol'; 
import '@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import '@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol';
import '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';

contract UnoAssetRouterBalancer is Initializable, PausableUpgradeable, UUPSUpgradeable {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    /**
     * @dev Contract Variables:
     * farmFactory - The contract that deploys new Farms and links them to {lpStakingPool}s.
     * accessManager - Role manager contract.
     */
    IUnoFarmFactory public farmFactory;
    IUnoAccessManager public accessManager;
    bytes32 private constant DISTRIBUTOR_ROLE = keccak256('DISTRIBUTOR_ROLE');
    bytes32 private constant PAUSER_ROLE = keccak256('PAUSER_ROLE');

    event Deposit(address indexed lpPool, address indexed from, address indexed recipient, uint256 amount);
    event Withdraw(address indexed lpPool, address indexed from, address indexed recipient, uint256 amount);
    event Distribute(address indexed lpPool, uint256 reward);

    modifier onlyDistributor(){
        require(accessManager.hasRole(DISTRIBUTOR_ROLE, msg.sender), 'CALLER_NOT_DISTRIBUTOR');
        _;
    }
    modifier onlyPauser(){
        require(accessManager.hasRole(PAUSER_ROLE, msg.sender), 'CALLER_NOT_PAUSER');
        _;
    }
    modifier onlyAdmin(){
        require(accessManager.hasRole(accessManager.ADMIN_ROLE(), msg.sender), 'CALLER_NOT_ADMIN');
        _;
    }

    // ============ Methods ============

    function initialize(address _accessManager, address _farmFactory) external initializer{
        __Pausable_init();
        accessManager = IUnoAccessManager(_accessManager);
        farmFactory = IUnoFarmFactory(_farmFactory);
    }

 /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the lpPair and deposits tokens.
     * @param amounts - Amounts of tokens to deposit.
     * @param tokens - Tokens to deposit.
     * @param amountLP - Amounts of LP tokens to deposit.
     * @param lpPair - Address of the pool to deposit tokens in.
     * @param recipient - Address which will recieve the deposit.

     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(uint256[] memory amounts, address[] memory tokens, uint256 amountLP, address lpPair, address recipient) external whenNotPaused returns(uint256 liquidity){
        require (amounts.length == tokens.length, 'AMOUNTS_AND_TOKENS_LENGTHS_NOT_MATCH');

        Farm farm = Farm(farmFactory.Farms(lpPair));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPair));
        }

        for (uint256 i = 0; i < tokens.length; i++) {
            if(amounts[i] > 0){
                IERC20Upgradeable(tokens[i]).safeTransferFrom(msg.sender, address(farm), amounts[i]);
            }
        }
        if(amountLP > 0){
            IERC20Upgradeable(lpPair).safeTransferFrom(msg.sender, address(farm), amountLP);
        }
        
        liquidity =  farm.deposit(amounts, tokens, amountLP, recipient);
        emit Deposit(lpPair, msg.sender, recipient, liquidity); 
    }

    /** 
     * @dev Withdraws tokens from the given pool. 
     * @param lpPair - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param withdrawLP - True: Withdraw in LP tokens, False: Withdraw in normal tokens.
     * @param recipient - The address which will recieve tokens.
     */ 
    function withdraw(address lpPair, uint256 amount, bool withdrawLP, address recipient) external whenNotPaused { 
        Farm farm = Farm(farmFactory.Farms(lpPair));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');
        
        farm.withdraw(msg.sender, amount, withdrawLP, recipient); 
        emit Withdraw(lpPair, msg.sender, recipient, amount);  
    }

    /**
     * @dev Sets expected reward amount and block for token distribution calculations. 
     * @param lpPair - LP pool to update.
     * @param expectedReward - New reward amount.
     * @param expectedRewardBlock - New reward block.
     *
     * Note: This function can only be called by the distributor.
     */  
    function setExpectedReward(address lpPair, uint256 expectedReward, uint256 expectedRewardBlock) external onlyDistributor {
        Farm farm = Farm(farmFactory.Farms(lpPair));
        require(farm != Farm(address(0)), 'FARM_NOT_EXISTS');
        
        farm.setExpectedReward(expectedReward, expectedRewardBlock); 
    }

    /**
     * @dev Distributes tokens between users for a single {Farms[lpPair]}.
     * @param lpPair - The pool to distribute. 
     * @param claims - Balancer token claims. 
     * @param rewardTokens - Reward tokens to recieve from the pool.
     * @param swaps - The data used to swap reward tokens for the needed tokens.
     * @param assets - The data used to swap reward tokens for the needed tokens.
     * @param funds - The data used to swap reward tokens for the needed tokens.
     * @param limits - The data used to swap reward tokens for the needed tokens.
     *
     * Note: This function can only be called by the distributor.
     */
    function distribute(
        address lpPair,
        MerkleOrchard.Claim[] memory claims,
        IERC20[] memory rewardTokens,
        IVault.BatchSwapStep[][] memory swaps,
        IAsset[][] memory assets,
        IVault.FundManagement[] memory funds,
        int256[][] memory limits
    ) external whenNotPaused onlyDistributor {
        Farm farm = Farm(farmFactory.Farms(lpPair));
        require(farm != Farm(address(0)), 'FARM_NOT_EXISTS');

        uint256 reward = farm.distribute(claims, rewardTokens, swaps, assets, funds, limits);
        emit Distribute(lpPair, reward);
    }

    /**
     * @dev Returns LP tokens staked by the {_address} for the given {lpPair}.
     * @param _address - The address to check stakes for.
     * @param lpPair - LP pool to check stakes in.

     * @return Total user stake(in LP tokens).
     */
   function userStake(address _address, address lpPair) external view returns(uint256){
        Farm farm = Farm(farmFactory.Farms(lpPair));
        if (farm != Farm(address(0))) {
            return farm.userBalance(_address);
        }
        return 0;
    }

    /**
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     * @param lpPair - LP pool to check total deposits in.

     * @return Total deposits (in LP tokens).
     */
    function totalDeposits(address lpPair) external view returns (uint256) {
        Farm farm = Farm(farmFactory.Farms(lpPair));
        if (farm != Farm(address(0))) {
            return farm.totalDeposits();
        }
        return 0;
    }

    function pause() external onlyPauser {
        _pause();
    }

    function unpause() external onlyPauser {
        _unpause();
    }

    function _authorizeUpgrade(address) internal override onlyAdmin {

    }
}
