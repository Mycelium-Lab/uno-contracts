// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;
pragma experimental ABIEncoderV2;

import {BalancerFarmUpgradeable as Farm, SafeMath, IERC20, IUniswapV2Pair, Initializable, MerkleOrchard, IVault, IAsset} from "./farms/BalancerFarmUpgradeable.sol"; 
 
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol"; 
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";

contract BalancerFarmFactoryBeacon is Initializable{
    using SafeMath for uint256; 

    /**
     * @dev Contract Variables:
     * {farmBeacon} - Farm contract implementation.
     *
     * {distributor} - Address authorized to make distributions.
     * {Farms} - Links {lpPools} to the deployed Farm contract.
     * {lpPools} - List of pools that have corresponding deployed Farm contract.
     */
    address public farmBeacon;

    address private distributor;
    mapping(address => Farm) public Farms;
    address[] public lpPools;

    event FarmDeployed(address indexed farmAddress);
    event Deposit(address indexed sender, address indexed lpPool, uint256 amount);
    event Withdraw(address indexed sender, address indexed lpPool, uint256 amount);
    event Distribute(address indexed lpPool);

    modifier distributorOnly(){
        require(msg.sender == distributor);
        _;
    }

    // ============ Methods ============

    function initialize(address upgrader, address _distributor) public initializer {
        UpgradeableBeacon _farmBeacon = new UpgradeableBeacon(
            address(new Farm())
        );
        _farmBeacon.transferOwnership(upgrader);
        farmBeacon = address(_farmBeacon);
        distributor = _distributor;
    }

    /**
     * @dev Deposits tokens in the given pool. Creates new Farm contract if there isn't one deployed for the lpPair and deposits tokens.
     * {amounts} - Amounts of tokens to deposit.
     * {tokens} - Tokens to deposit.
     * {amountLP} - Amounts of LP tokens to deposit.
     * {lpPair} - Address of the pool to deposit tokens in.
     *
     * {liquidity} - Total liquidity sent to the farm (in lpTokens).
     */
    function deposit(uint256[] memory amounts, IERC20[] memory tokens, uint256 amountLP, address lpPair) external returns(uint256 liquidity){
        require (amounts.length == tokens.length, "Amounts and tokens must have the same length");
        if(Farms[lpPair] == Farm(address(0))){
            Farms[lpPair] = Farm(createFarm(lpPair));
            lpPools.push(lpPair);
        }

        for (uint256 i = 0; i < tokens.length; i++) {
            if(amounts[i] > 0){
                tokens[i].transferFrom(msg.sender, address(Farms[lpPair]), amounts[i]);
            }
        }
        if(amountLP > 0){
            IERC20(lpPair).transferFrom(msg.sender, address(Farms[lpPair]), amountLP);
        }

        liquidity = Farms[lpPair].deposit(amounts, tokens, amountLP, msg.sender);
        emit Deposit(msg.sender, lpPair, liquidity);
    }

    /**
     * @dev Withdraws tokens from the given pool. 
     * {lpPair} - LP pool to withdraw from.
     * {amount} - LP amount to withdraw. 
     * {withdrawLP} - True: Withdraw in LP tokens, False: Withdraw in normal tokens.
     * {recipient} - The address which will recieve tokens.
     */ 
    function withdraw(address lpPair, uint256 amount, bool withdrawLP, address recipient) external{ 
        require(Farms[lpPair] != Farm(address(0)), 'The given pool doesnt exist'); 
        Farms[lpPair].withdraw(msg.sender, amount, withdrawLP, recipient); 
        emit Withdraw(msg.sender, lpPair, amount);
    }

     /**
     * @dev Distributes tokens between users for a single {Farms[lpPair]}.
     * {lpPair} - The pool to distribute. 
     * {claims} - Balancer token claims. 
     * {rewardTokens} - Reward tokens to recieve from the pool.
     * {swaps,assets,funds,limits} - The data used to swap reward tokens for the needed tokens.
     *
     * This function can only be called by the distributor.
     */
    function distribute(
        address lpPair,
        MerkleOrchard.Claim[] memory claims,
        IERC20[] memory rewardTokens,
        IVault.BatchSwapStep[][] memory swaps,
        IAsset[][] memory assets,
        IVault.FundManagement[] memory funds,
        int256[][] memory limits
    ) external distributorOnly {
        require(Farms[lpPair] != Farm(address(0)), 'The pool doesnt exist');
        require(swaps.length == assets.length, "Swaps' length doesn't match assets'");
        require(swaps.length == funds.length,  "Swaps' length doesn't match funds'");
        require(swaps.length == limits.length, "Swaps' length doesn't match limits'");

        Farms[lpPair].distribute(claims, rewardTokens, swaps, assets, funds, limits);
        emit Distribute(lpPair);
    }

    /**
     * @dev Returns LP tokens staked by the {_address} for the given {lpPair}.
     */ 
    function userStake(address _address, address lpPair) external view returns(uint256){
        if(Farms[lpPair] != Farm(address(0))){
            return Farms[lpPair].userBalance(_address);
        }
        return 0;
    }    
    
    /**
     * @dev Returns total amount locked in the pool. Doesn't take pending rewards into account.
     */ 
    function totalDeposits(address lpPair) external view returns (uint256) {
        if (Farms[lpPair] != Farm(address(0))){
            return Farms[lpPair].getTotalDeposits();
        }
        return 0;
    }

    function poolLength() external view returns (uint256){
        return lpPools.length;
    }

    function transferDistributor(address newDistributor) external distributorOnly {
        distributor = newDistributor;
    }

    /**
     * @dev Deploys new Farm contract and calls initialize on it.
     */
    function createFarm(address lpPair) internal returns (address) {
        BeaconProxy proxy = new BeaconProxy(
            farmBeacon,
            abi.encodeWithSelector(
                Farm(address(0)).initialize.selector,
                lpPair,
                address(this)
            )
        );
        emit FarmDeployed(address(proxy));
        return address(proxy);
    }
}
