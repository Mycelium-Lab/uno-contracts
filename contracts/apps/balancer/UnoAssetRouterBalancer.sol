// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {IUnoFarmBalancer as Farm} from './interfaces/IUnoFarmBalancer.sol'; 
import '../../interfaces/IUnoFarmFactory.sol';
import '../../interfaces/IUnoAccessManager.sol'; 
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
     * farmFactory - The contract that deploys new Farms and links them to {lpPool}s.
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
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the {lpPool} and deposits tokens in it.
     * @param lpPool - Address of the pool to deposit tokens in.
     * @param amounts - Amounts of tokens to deposit.
     * @param tokens - Tokens to deposit.
     * @param minAmountLP - Minimum LP the user will receive from {{tokens}} deposit.
     * @param amountLP - Additional amount of LP tokens to deposit.
     * @param recipient - Address which will recieve the deposit.

     * @return liquidity - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(address lpPool, uint256[] memory amounts, address[] memory tokens, uint256 minAmountLP, uint256 amountLP, address recipient) external whenNotPaused returns(uint256 liquidity){
        require (amounts.length == tokens.length, 'AMOUNTS_AND_TOKENS_LENGTHS_NOT_MATCH');

        Farm farm = Farm(farmFactory.Farms(lpPool));
        if(farm == Farm(address(0))){
            farm = Farm(farmFactory.createFarm(lpPool));
        }

        for (uint256 i = 0; i < tokens.length; i++) {
            if(amounts[i] > 0){
                IERC20Upgradeable(tokens[i]).safeTransferFrom(msg.sender, address(farm), amounts[i]);
            }
        }
        if(amountLP > 0){
            IERC20Upgradeable(lpPool).safeTransferFrom(msg.sender, address(farm), amountLP);
        }
        
        liquidity = farm.deposit(amounts, tokens, minAmountLP, amountLP, recipient);
        emit Deposit(lpPool, msg.sender, recipient, liquidity); 
    }

    /** 
     * @dev Withdraws tokens from the given pool. 
     * @param lpPool - LP pool to withdraw from.
     * @param amount - LP amount to withdraw. 
     * @param minAmountsOut - Minimum token amounts the user will recieve.
     * @param withdrawLP - True: Withdraw in LP tokens, False: Withdraw in normal tokens.
     * @param recipient - The address which will recieve tokens.
     */ 
    function withdraw(address lpPool, uint256 amount, uint256[] calldata minAmountsOut, bool withdrawLP, address recipient) external whenNotPaused { 
        Farm farm = Farm(farmFactory.Farms(lpPool));
        require(farm != Farm(address(0)),'FARM_NOT_EXISTS');
        
        farm.withdraw(amount, minAmountsOut, withdrawLP, msg.sender, recipient); 
        emit Withdraw(lpPool, msg.sender, recipient, amount);  
    }

    /**
     * @dev Distributes tokens between users for a single {Farms[lpPool]}.
     * @param lpPool - The pool to distribute. 
     * @param swaps - The data used to swap reward tokens for the needed tokens.
     * @param assets - The data used to swap reward tokens for the needed tokens.
     * @param limits - The data used to swap reward tokens for the needed tokens.
     *
     * Note: This function can only be called by the distributor.
     */
    function distribute(
        address lpPool,
        IVault.BatchSwapStep[][] memory swaps,
        IAsset[][] memory assets,
        int256[][] memory limits
    ) external whenNotPaused onlyDistributor {
        Farm farm = Farm(farmFactory.Farms(lpPool));
        require(farm != Farm(address(0)), 'FARM_NOT_EXISTS');

        uint256 reward = farm.distribute(swaps, assets, limits);
        emit Distribute(lpPool, reward);
    }

    /**
     * @dev Returns LP tokens staked by the {_address} for the given {lpPool}.
     * @param _address - The address to check stakes for.
     * @param lpPool - LP pool to check stakes in.

     * @return Total user stake(in LP tokens).
     */
   function userStake(address _address, address lpPool) external view returns(uint256){
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if (farm != Farm(address(0))) {
            return farm.userBalance(_address);
        }
        return 0;
    }

    /**
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     * @param lpPool - LP pool to check total deposits in.

     * @return Total deposits (in LP tokens).
     */
    function totalDeposits(address lpPool) external view returns (uint256) {
        Farm farm = Farm(farmFactory.Farms(lpPool));
        if (farm != Farm(address(0))) {
            return farm.getTotalDeposits();
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
