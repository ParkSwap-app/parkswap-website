<?php
defined('BASEPATH') OR exit('No direct script access allowed');

/*
| -------------------------------------------------------------------------
| URI ROUTING
| -------------------------------------------------------------------------
| This file lets you re-map URI requests to specific controller functions.
|
| Typically there is a one-to-one relationship between a URL string
| and its corresponding controller class/method. The segments in a
| URL normally follow this pattern:
|
|	example.com/class/method/id/
|
| In some instances, however, you may want to remap this relationship
| so that a different class/function is called than the one
| corresponding to the URL.
|
| Please see the user guide for complete details:
|
|	https://codeigniter.com/user_guide/general/routing.html
|
| -------------------------------------------------------------------------
| RESERVED ROUTES
| -------------------------------------------------------------------------
|
| There are three reserved routes:
|
|	$route['default_controller'] = 'welcome';
|
| This route indicates which controller class should be loaded if the
| URI contains no data. In the above example, the "welcome" class
| would be loaded.
|
|	$route['404_override'] = 'errors/page_missing';
|
| This route will tell the Router which controller/method to use if those
| provided in the URL cannot be matched to a valid route.
|
|	$route['translate_uri_dashes'] = FALSE;
|
| This is not exactly a route, but allows you to automatically route
| controller and method names that contain dashes. '-' isn't a valid
| class or method name character, so it requires translation.
| When you set this option to TRUE, it will replace ALL dashes in the
| controller and method URI segments.
|
| Examples:	my-controller/index	-> my_controller/index
|		my-controller/my-method	-> my_controller/my_method
*/
$route['default_controller']   = 'home';
$route['404_override']         = '';
$route['translate_uri_dashes'] = FALSE;


$route['terms']		= 'home/terms';
$route['privacy']	= 'home/privacy';
$route['aboutUs']	= 'home/aboutUs';
$route['blog']	= 'home/blog';
$route['blog-detail']	= 'home/blog_detail';
$route['newslatter']	= 'home/newslatter';
$route['payment/account-verify/success']	= 'payment/account_verify_success';
$route['payment/account-verify/fail']	= 'payment/account_verify_fail';

/* API V1 routes start */

//Auth routes

$route ['api/v1/auth/signup']              = 'api_v1/Auth/signup';
// The legacy public FCM test route was removed. Production notifications are
// sent only through authenticated parking workflows.
$route ['api/v1/auth/complete-profile']    = 'api_v1/Auth/complete_profile';
$route ['api/v1/auth/car-details']         = 'api_v1/Auth/car_details';
$route ['api/v1/auth/complete-onboarding'] = 'api_v1/Auth/complete_onboarding';
$route ['api/v1/auth/login']               = 'api_v1/Auth/login';
$route ['api/v1/auth/logout']              = 'api_v1/Auth/logout';
$route ['api/v1/auth/reset-password']      = 'api_v1/Auth/reset_password';
$route ['api/v1/auth/social-signup']       = 'api_v1/Auth/social_signup';
$route ['api/v1/auth/check-social-signup'] = 'api_v1/Auth/check_social_signup';
$route ['api/v1/auth/social-config']['get'] = 'api_v1/Auth/social_config';
$route ['api/v1/auth/social-identity']['post'] = 'api_v1/Auth/social_identity';
$route ['api/v1/auth/skip-step']           = 'api_v1/Auth/skip_step';
$route ['api/v1/user/change-password']     = 'api_v1/user/change_password';
$route ['api/v1/user/change-language']     = 'api_v1/user/change_language';
$route ['api/v1/user/alert-settings']      = 'api_v1/user/alert_settings';
$route ['api/v1/general/feedback']         = 'api_v1/general/feedback';
$route['api/v1/general/app-launch']['get']			= 'api_v1/general/appLaunch';
$route ['api/v1/payment/bank-account']    = 'api_v1/payment/bank_account';
$route ['api/v1/payment/bank-account/(:any)']['put'] = 'api_v1/payment/bank_account/$1';
$route ['api/v1/user/car-details/(:num)']['put'] = 'api_v1/user/car_details/$1';
$route ['api/v1/user/car-details'] = 'api_v1/user/car_details';
$route ['api/v1/user/user-profile'] = 'api_v1/user/user_profile';
$route ['api/v1/user/update-profile'] = 'api_v1/user/update_profile';
$route ['api/v1/payment/card']    = 'api_v1/payment/card';
$route ['api/v1/payment/create-customer']    = 'api_v1/payment/create_customer';
$route ['api/v1/payment/card-list']    = 'api_v1/payment/card_list';
$route ['api/v1/payment/subscription-purchase-verify']    = 'api_v1/payment/subscription_purchase_verify';
$route ['api/v1/payment/card/(:num)']['delete'] = 'api_v1/payment/card/$1';
$route ['api/v1/payment/card/(:any)']['patch'] = 'api_v1/payment/card/$1';
$route ['api/v1/parking/request']= 'api_v1/parking/request';
$route ['api/v1/parking/list']['get'] = 'api_v1/parking/list';
$route ['api/v1/parking/activity-zones']['get'] = 'api_v1/parking/activity_zones';
$route ['api/v1/parking/swap-spot'] = 'api_v1/parking/swap_spot';
$route ['api/v1/parking/drive-spot'] = 'api_v1/parking/drive_spot';
$route ['api/v1/parking/swap-connection/(:num)/close']['patch'] = 'api_v1/parking/swap_connection_close/$1';
$route ['api/v1/parking/swap-connection'] = 'api_v1/parking/swap_connection';
$route ['api/v1/parking/pay-gratuity'] = 'api_v1/parking/pay_gratuity';
// Parking Network endpoints are additive and default to FEATURE_DISABLED until
// PARKSWAP_FEATURE_SCHEDULED_DEPARTURES=1 is configured after migration.
$route ['api/v1/parking-network/scheduled-departures']['post'] = 'api_v1/parking_network/scheduled_departure';
$route ['api/v1/parking-network/scheduled-departures/active']['get'] = 'api_v1/parking_network/active';
$route ['api/v1/parking-network/scheduled-departures/nearby']['get'] = 'api_v1/parking_network/nearby';
$route ['api/v1/parking-network/scheduled-departures/(:num)/confirm']['post'] = 'api_v1/parking_network/confirm/$1';
$route ['api/v1/parking-network/scheduled-departures/(:num)/delay']['post'] = 'api_v1/parking_network/delay/$1';
$route ['api/v1/parking-network/scheduled-departures/(:num)/cancel']['post'] = 'api_v1/parking_network/cancel/$1';
$route ['api/v1/parking-network/scheduled-departures/(:num)/claim']['post'] = 'api_v1/parking_network/claim/$1';
$route ['api/v1/parking-network/reliability']['get'] = 'api_v1/parking_network/reliability';
$route ['api/v1/parking-network/spotter-reports']['post'] = 'api_v1/parking_network/spotter_report';
$route ['api/v1/parking-network/spotter-reports/active']['get'] = 'api_v1/parking_network/spotter_active';
$route ['api/v1/parking-network/spotter-reports/nearby']['get'] = 'api_v1/parking_network/spotter_nearby';
$route ['api/v1/parking-network/spotter-reports/history']['get'] = 'api_v1/parking_network/spotter_history';
$route ['api/v1/parking-network/spotter-reports/(:num)/claim']['post'] = 'api_v1/parking_network/spotter_claim/$1';
$route ['api/v1/parking-network/spotter-reports/(:num)/confirm']['post'] = 'api_v1/parking_network/spotter_confirm/$1';
$route ['api/v1/parking-network/spotter-reports/(:num)/cancel']['post'] = 'api_v1/parking_network/spotter_cancel/$1';
$route ['api/v1/parking-network/spotter-reports/(:num)/dispute']['post'] = 'api_v1/parking_network/spotter_dispute/$1';
$route ['api/v1/payment/transactions']    = 'api_v1/payment/transactions';
$route ['api/v1/payment/subscription-plans']    = 'api_v1/payment/subscription_plans';
$route ['api/v1/payment/subscription-purchase']    = 'api_v1/payment/subscription_purchase';
$route ['api/v1/payment/check-account']   = 'api_v1/payment/check_account';
$route ['api/v1/payment/account-verification']   = 'api_v1/payment/account_verification/';
$route ['api/v1/payment/account-verification/(:any)']['put']   = 'api_v1/payment/account_verification/$1';
$route ['api/v1/alerts']    = 'api_v1/alerts';
$route ['api/v1/alert/(:num)/read']['patch'] = 'api_v1/alerts/$1';
$route ['api/v1/alert/read-all']['patch'] = 'api_v1/alerts/read_all';
$route ['api/v1/garage/list']['get'] = 'api_v1/garage/list';


//for api version v2
$route ['api/v2/payment/save-card']    = 'api_v2/payment/card';
$route ['api/v2/payment/card-intent']    = 'api_v2/payment/card_intent';
$route ['api/v2/parking/pay-gratuity'] = 'api_v2/parking/pay_gratuity';
$route ['api/v2/payment/card/(:num)']['delete'] = 'api_v2/payment/card/$1';
$route ['api/v2/payment/card']['delete'] = 'api_v2/payment/card/$1';
$route ['api/v2/payment/transactions']    = 'api_v2/payment/transactions';
$route ['api/v2/user/delete_profile'] = 'api_v2/user/delete_profile';

/* API V1 routes End */
