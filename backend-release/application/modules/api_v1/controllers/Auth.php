<?php

if(!defined('BASEPATH')) exit('No direct script access allowed');
class Auth extends Common_Service_Controller{

	function __construct() {

		parent::__construct();
		$this->load->model('auth_model');
		$this->load->model('user_model');
		$this->load->library('smtp_email');
		$this->load->library('Stripe');
		$this->load->library('social_identity_verifier');
	}

	/** Public, non-secret provider configuration used by the web client. */
	public function social_config_get() {
		$this->success_response('Social sign-in configuration.', $this->social_identity_verifier->public_config());
	}

	/**
	 * Verified Google/Apple sign-in for web and upgraded native clients.
	 * The legacy social endpoints remain available for backward compatibility.
	 */
	public function social_identity_post() {
		$provider = strtolower(trim((string) $this->input->post('provider')));
		$id_token = trim((string) $this->input->post('id_token'));
		$nonce = trim((string) $this->input->post('nonce'));
		$device_token = sanitize_input_text($this->input->post('device_token'));

		if (!in_array($provider, array('google', 'apple'), TRUE) || $id_token === '' || $nonce === '' || $device_token === '') {
			$this->error_response('Provider, identity token, nonce, and device token are required.');
		}

		try {
			$identity = $this->social_identity_verifier->verify($provider, $id_token, $nonce);
		} catch (InvalidArgumentException $e) {
			$this->error_response($e->getMessage(), 'INVALID_SOCIAL_IDENTITY', 401);
		} catch (Exception $e) {
			log_message('error', 'Social identity verification failed for '.$provider.': '.$e->getMessage());
			$this->error_response('Social sign-in is temporarily unavailable. Please try again.', 'SOCIAL_IDENTITY_UNAVAILABLE', 503);
		}

		$social_type = $provider === 'google' ? 1 : 3;
		$social_where = array('social_id' => $identity['subject'], 'social_type' => $social_type);
		$social_account = $this->common_model->getsingle(SOCIAL_ACCOUNTS, $social_where);
		$user = NULL;
		$is_new_user = FALSE;

		$this->db->trans_begin();
		if (!empty($social_account)) {
			$user = $this->common_model->getsingle(USERS, array('userID' => $social_account->user_id));
		} else {
			$user = $this->common_model->getsingle(USERS, array('email' => $identity['email']));
			if (!empty($user) && (int) $user->status !== 2) {
				$existing_link = $this->common_model->getsingle(SOCIAL_ACCOUNTS, $social_where);
				if (empty($existing_link)) {
					$this->auth_model->socialRegistartion(array(
						'user_id' => $user->userID,
						'social_id' => $identity['subject'],
						'social_type' => $social_type,
						'created_at' => datetime(),
						'is_signup' => 0,
					));
				}
			} else if (!empty($user)) {
				$this->db->trans_rollback();
				$this->error_response('This ParkSwap account is unavailable.', 'ACCOUNT_UNAVAILABLE', 403);
			} else {
				$user_data = array(
					'email' => $identity['email'],
					'full_name' => $identity['name'],
					'last_login_at' => datetime(),
					'profile_language' => $this->request_headers['language'],
					'profile_timezone' => $this->request_headers['timezone'],
					'created_at' => datetime(),
					'updated_at' => datetime(),
					'signup_from' => $this->request_headers['device-type'],
					'status' => 1,
					'onboarding_step' => 2,
					'signup_type' => 2,
					'is_subscribed' => 1,
				);
				$user_id = $this->auth_model->userRegistartion($user_data);
				if (!$user_id) {
					$this->db->trans_rollback();
					$this->error_response('ParkSwap could not create the account. Please try again.', 'ACCOUNT_CREATE_FAILED', 500);
				}
				$this->auth_model->socialRegistartion(array(
					'user_id' => $user_id,
					'social_id' => $identity['subject'],
					'social_type' => $social_type,
					'created_at' => datetime(),
					'is_signup' => 1,
				));
				$user = $this->common_model->getsingle(USERS, array('userID' => $user_id));
				$is_new_user = TRUE;
			}
		}

		if (empty($user) || (int) $user->status !== 1) {
			$this->db->trans_rollback();
			$this->error_response('This ParkSwap account is unavailable.', 'ACCOUNT_UNAVAILABLE', 403);
		}

		$device_info = array(
			'user_id' => $user->userID,
			'device_type' => $this->request_headers['device-type'],
			'device_id' => $this->request_headers['device-id'],
			'device_token' => $device_token,
			'device_timezone' => $this->request_headers['timezone'],
			'created_at' => datetime(),
			'updated_at' => datetime(),
		);
		$this->auth_model->add_device_info($device_info);
		$this->common_model->updateFields(USERS, array('last_login_at' => datetime(), 'updated_at' => datetime()), array('userID' => $user->userID));

		if ($this->db->trans_status() === FALSE) {
			$this->db->trans_rollback();
			$this->error_response('ParkSwap could not complete sign-in. Please try again.', 'SOCIAL_SIGN_IN_FAILED', 500);
		}
		$this->db->trans_commit();

		$auth_token = $this->general_model->generate_token($user->userID, $this->request_headers['device-id']);
		$user_info = $this->general_model->getUserDetail($user->userID, $this->request_headers['device-id']);
		$user_info->auth_token = $auth_token;
		$this->success_response($is_new_user ? get_response_message(105) : get_response_message(121), array(
			'user_details' => $user_info,
			'social_status' => $is_new_user ? 2 : 1,
			'is_new_user' => $is_new_user,
		));
	}

	/**
	 *  regular signup.     
	 */
	public	function signup_post() {

		$this->verifyValidation();  //Validate params
		$data['email']          = sanitize_input_text($this->input->post('email'));
		
		$data['password']           = password_hash(sanitize_input_text($this->input->post('password')),PASSWORD_DEFAULT);

		
		$device_token               = sanitize_input_text($this->input->post('device_token'));
		$data['profile_language']   = $this->request_headers['language'];
		$data['created_at']         = datetime();
		$data['updated_at']         = datetime();
		$data['signup_from']        = $this->request_headers['device-type'];
		$data['profile_timezone']   = $this->request_headers['timezone'];
		$data['status']             = 1;
		$data['onboarding_step']    = 2;
		$data['signup_type']        = 1;
		$data['is_subscribed']    = 1;

	
		if($this->form_validation->run() == FALSE) {
			$responseArray = $this->error_response(strip_tags(validation_errors())); // validation error
		}
		
		$result   = $this->auth_model->userRegistartion($data); // data insert in user table
		if($result) {

			$device_info = array(
				'user_id'            => $result,
				'device_type'        => $this->request_headers['device-type'],
				'device_id'          => $this->request_headers['device-id'],
				'device_token'       => $device_token,
				'device_timezone'    => $this->request_headers['timezone'],
				'created_at'         => datetime(),
				'updated_at'         => datetime()
			);
			$add = $this->auth_model->add_device_info($device_info); // add and update device info

			$genrate_token = $this->general_model->generate_token($result, $this->request_headers['device-id']); // genrate token

			$user_info = $this->general_model->getUserDetail($result,$this->request_headers['device-id']); // get user details

			$user_info->auth_token = $genrate_token ;

			$this->appLang = 'english'; //default langauge
				$lang_arr = array('en'=>'english', 'es'=>'spanish');


				if(!empty($user_info->profile_language)) {

		            $lang_val = $user_info->profile_language;
		            if(array_key_exists($lang_val , $lang_arr )){
		                $this->appLang = $lang_arr[$lang_val];
		            }
			    }
			        
            	$this->lang->load('response_messages_lang', $this->appLang);

            //send email to admin on successfully registered	
		    $data['subject'] = 'ParkSwap- New account created.';
		    $message = "Email:- ".$data['email'];
		    $this->load->library('smtp_email');

		    $check   =  $this->smtp_email->send_mail(getenv('ADMIN_EMAIL'),$data['subject'],$message);
		  

			$this->success_response(get_response_message(105),array('user_details'=>$user_info));
		} // sucess message

		$this->error_response(get_response_message(107));  // 
	}

    /**
	 *  social signup      
	 */
	public	function social_signup_post() {
      
		$this->form_validation->set_rules('social_id','Social id ','required',array('required'=>lang('form_validation_required')));
		$this->form_validation->set_rules('social_type','Social type','required',array('required'=>lang('form_validation_required')));
		$this->form_validation->set_rules('device_token','DeviceToken','required',array('required'=>lang('form_validation_required')));
		if($this->input->post('social_type')!=3){

			$this->form_validation->set_rules('email','Email','required|valid_email',array('required'=>lang('form_validation_required')),array('valid_email'=>lang('form_validation_valid_emails')));
		}
  		$social_id = sanitize_input_text($this->input->post('social_id'));
  		$email= sanitize_input_text($this->input->post('email'));

  		if($this->input->post('social_type')==3 && empty($this->input->post('email'))){
  			$email = $social_id.'@apple.com';
  		}
		$where = array('social_id'=> $social_id);
		$where1 = array('email'=> $email);

		$isUserExits = $this->common_model->getsingle(SOCIAL_ACCOUNTS, $where);
		$isEmailExits = $this->common_model->getsingle(USERS, $where1);
	
		if($this->form_validation->run() == FALSE) {

			$responseArray = $this->error_response(strip_tags(validation_errors()));
		}

		//$email                      = sanitize_input_text($this->input->post('email'));
		$device_token               = sanitize_input_text($this->input->post('device_token'));
		$data['last_login_at']      = datetime();
        $data['email']              = $email;
		$data['profile_language']   = $this->request_headers['language'];
		$data['created_at']         = datetime();
		$data['updated_at']         = datetime();
		$data['signup_from']        = $this->request_headers['device-type'];
		$data['status']             = 1;
		$data['onboarding_step']    = 2;
		$data['is_subscribed']    = 1;

		if($this->input->post('social_type')==3){
  			$data['onboarding_step']    = 3;
  		}
		$data['signup_type']        = 2;

		$socialData = array(
		    'social_id'        => sanitize_input_text($this->input->post('social_id')),
		    'social_type'      => sanitize_input_text($this->input->post('social_type')),
		    'created_at'       => datetime(),
		    'is_signup'        => 1
		);
		    
		$socialType = array(1, 2,3); // 1:Google, 2:Facebook

        if(!in_array( $socialData['social_type'], $socialType)) {
        
           $this->error_response(get_response_message(565));
           
        }
        
		$device_info = array(
			'device_type'        => $this->request_headers['device-type'],
			'device_id'          => $this->request_headers['device-id'],
			'device_token'       => $device_token,
			'device_timezone'    => $this->request_headers['timezone'],
			'created_at'         => datetime(),
			'updated_at'         => datetime()
		);

		if(!empty($isUserExits)){
		 $this->error_response(get_response_message(310));
		}

		if(!empty($isEmailExits) && $isEmailExits->status != 2 ) {
			 $this->error_response(get_response_message(508));
	    }

	    if(empty($isUserExits) && (empty($isEmailExits) || $isEmailExits->status == 2)){

 			    $res   = $this->auth_model->userRegistartion($data);

        		if($res) {

					$socialData= array(
						'user_id'	       => $res,
						'social_id'        => sanitize_input_text($this->input->post('social_id')),
						'social_type'      => sanitize_input_text($this->input->post('social_type')),
						 'created_at'      => datetime(),
						 'is_signup'       => 1
					);
					$socialType = array(1, 2, 3); // 1:Google, 2:Facebook 3:Apple

        				if(!in_array( $socialData['social_type'], $socialType)) {
        
           					$this->error_response(get_response_message(565));
           				}

					$result = $this->auth_model->socialRegistartion($socialData);

					if($result) {

						$device_info['user_id']    = $res ;
						$add                       = $this->auth_model->add_device_info($device_info);
						$genrate_token	           = $this->general_model->generate_token($res,$this->request_headers['device-id']);
						$user_info   = $this->user_model->getUserDetails($socialData,$email);
						$user_info->auth_token     = $genrate_token ;
					}
				}
				$this->appLang = 'english'; //default langauge
				$lang_arr = array('en'=>'english', 'es'=>'spanish');

				if(!empty($user_info->profile_language)) {

		            $lang_val = $user_info->profile_language;
		            if(array_key_exists($lang_val , $lang_arr )){
		                $this->appLang = $lang_arr[$lang_val];
		            }
			    }
			        
            	$this->appLang = $lang_arr[$user_info->profile_language];
            	$this->lang->load('response_messages_lang', $this->appLang);
			
            	$data['subject'] = 'ParkSwap- New account created.';
			    $message = "Email:- ".$data['email'];
			    $this->load->library('smtp_email');

			    $check   =  $this->smtp_email->send_mail(getenv('ADMIN_EMAIL'),$data['subject'],$message);
		    
				$responseArray = $this->success_response(get_response_message(105),array('user_details'=>$user_info,'social_status'=>"2"));
			}
	}

    /*
	* api for complete profile
	*/

  	public function complete_profile_post() {

        $this->load->model('Image_model');
        $this->check_service_auth();
 		$user_id = $this->authData->userID;
 		$email = $this->authData->email;
 		//pr($email);

        $this->form_validation->set_rules('full_name','full_name','required',array('required'=>lang('form_validation_required')));
		// $this->form_validation->set_rules('gender','gender','required',array('required'=>lang('form_validation_required')));
		$this->form_validation->set_rules('age','Age','required|numeric',array('required'=>lang('form_validation_required')),array('numeric'=>lang('form_validation_numeric')));
		// $this->form_validation->set_rules('profile_address','Address','required',array('required'=>lang('form_validation_required')));
		// $this->form_validation->set_rules('profile_latitude','profile_latitude','required',array('required'=>lang('form_validation_required')));
		// $this->form_validation->set_rules('profile_longitude','profile_longitude','required',array('required'=>lang('form_validation_required')));

    	if($this->form_validation->run() == FALSE) {
  			
  			$responseArray = $this->error_response(strip_tags(validation_errors()));
	    }
	     $where_userId    =  array('userID'=>$user_id,'onboarding_step'=>2);
		    $is_exists_userId = $this->common_model->get_field_value(USERS, $where_userId,'userID');
             
			if(empty($is_exists_userId)) {

				$this->error_response(get_response_message(562));
			}

		if(!empty($_FILES['avatar'])) {

	        $imageName = 'avatar';
	        $folder    = "profile";
	        $this->load->model('Image_model');
	        $response  = $this->Image_model->upload_image($imageName,$folder);

	        if(!empty($response['error'])) {
	          	
	          $this->error_response(get_response_message(558));	
	    	}
    	    $data['avatar'] = $response['image_name'];

    	    $data['is_avatar_url']       =  1;

        }
            $data['full_name']           = $this->input->post('full_name');
            $data['gender']              = $this->input->post('gender');
	        $data['age']                 = $this->input->post('age');
	        $data['updated_at']          = datetime();

	        if (!empty($this->input->post('profile_address'))) {
	        	$data['profile_address']     = $this->input->post('profile_address');
	        	$data['profile_latitude']    = $this->input->post('profile_latitude');
	        	$data['profile_longitude']   = $this->input->post('profile_longitude');
	        }
	       
	        $gender = array(1, 2); //1:male, 2:female

        // if(!in_array( $data['gender'], $gender))
        // {
        //    $this->error_response(get_response_message(563));
           
        // }
	        
		$isExist = $this->common_model->get_field_value(USERS, $where_userId,'avatar');
		$connect_account_data = $this->stripe->create_connected_account($email,$full_name = $this->input->post('full_name'));
		// pr($connect_account_data);
		 
		$result  = $this->auth_model->complete_profile($data,$user_id);

        if(!empty($result)) {
    		
          	if($isExist) {

	    		$path = 'profile';
	    		$this->Image_model->delete_image($path,$isExist);
    		}

			if(!empty($connect_account_data['data']['id'])){
				$stripe_connect_account_id =$connect_account_data['data']['id'];
			}
		   
		   //pr($stripe_connect_account_id);
		   $where         = array('userID'=>$user_id);
		   // $update_data   = array('stripe_connect_account_id'=>$stripe_connect_account_id);
		   $update_data   = array('onboarding_step'=>3,
		   	'stripe_connect_account_id' =>$stripe_connect_account_id
		   	);
		   //pr($update_data);
		   
		   $res           = $this->common_model->updateFields(USERS, $update_data, $where);
		 

		   $user_info = $this->general_model->getUserDetail($user_id,$this->request_headers['device-id']);
           
           $this->success_response(get_response_message(123),array('user_details'=>$user_info));
		}
          	
          $this->error_response(get_response_message(107));
    }

    /*
     *  api for car-details   
    */
    public function car_details_post() {

    	$this->check_service_auth();
    	$user_id = $this->authData->userID;
        $this->form_validation->set_rules('make','make','required',array('required'=>lang('form_validation_required')));
		$this->form_validation->set_rules('model','model','required',array('required'=>lang('form_validation_required')));
		$this->form_validation->set_rules('color','color','required',array('required'=>lang('form_validation_required')));
		$this->form_validation->set_rules('plate_number','plate','required',array('required'=>lang('form_validation_required')));


		if($this->form_validation->run() == FALSE) {
  			
  			$responseArray = $this->error_response(strip_tags(validation_errors()));
	    }
	    $where_userId    =  array('userId'=>$user_id,'onboarding_step'=>3);
		$is_exists_userId = $this->common_model->get_field_value(USERS, $where_userId,'userID');
             
			if(empty($is_exists_userId)) {

			$this->error_response(get_response_message(564));
			}

        $data['user_id']      = $user_id;
        $data['make']         = $this->post('make');
        $data['model']        = $this->post('model');
        $data['color']        = $this->post('color');
        $data['plate_number'] = $this->post('plate_number');
        $data['created_at']   = datetime();
        $data['updated_at']   = datetime();
        $result               = $this->auth_model->car_details($data,$user_id);
        if($result){ 
        $where                = array('userId'=>$user_id);
		$update_data          = array('onboarding_step'=>4);
		$res                  = $this->common_model->updateFields(USERS, $update_data, $where);
		if($res){
			
		$user_info = $this->general_model->getUserDetail($this->authData->userID, $this->request_headers['device-id']);
        $this->success_response(get_response_message(123), ['user_details' =>$user_info]);
			
		}
	   
            $this->error_response(get_response_message(107));
		}
    }

    // complete onboarding step
    public function complete_onboarding_patch() {

    	$this->check_service_auth();
    	$user_id = $this->authData->userID;

    	$where_userId = array('userID'=>$user_id,'onboarding_step'=>4);

		$is_exists_userId = $this->common_model->get_field_value(USERS, $where_userId,'userID');
	
		if(empty($is_exists_userId)){
			$this->error_response(get_response_message(564)); // error response
   		}

        $where            = array('userID'=>$user_id);
		$update_data      = array('onboarding_completed'=>1);
		$res              = $this->common_model->updateFields(USERS, $update_data, $where);

		$user_info = $this->general_model->getUserDetail($this->authData->userID, $this->request_headers['device-id']);
        $this->success_response(get_response_message(123), ['user_details' =>$user_info]);
    }
        
  	/*
     *  validate input which is give in registration api.     
    */
  	private function verifyValidation() {

		$this->form_validation->set_rules('email','email','required|valid_email',array('required'=>lang('form_validation_required')),array('valid_email'=>lang('form_validation_valid_emails')));
		$this->form_validation->set_rules('password','Password','required|min_length[1]',array('required'=>lang('form_validation_required'),'min_length'=>lang('form_validation_min_length')));
		$this->form_validation->set_rules('confirm_password','Confirm Password','required|min_length[1]',array('required'=>lang('form_validation_required'),'min_length'=>lang('form_validation_min_length')));
		$this->form_validation->set_rules('device_token','deviceToken','required|min_length[1]',array('required'=>lang('form_validation_required'),'min_length'=>lang('form_validation_min_length')));
		
		if($this->input->post('email') !='') {

	    	$this->form_validation->set_rules('email', 'Email', 'valid_email',array('valid_email'=>lang('form_validation_valid_emails')));
	    }

        if($this->input->post('email') != "") {
	     	$email = sanitize_input_text($this->input->post('email'));
			$where = array('email' => $email);
 			$is_exists = $this->common_model->is_data_exists(USERS, $where);
			
	    	if(!empty($is_exists) && $is_exists->status != 2){
				
 				$responseArray = $this->error_response(get_response_message(508));
	    	}
	    }

	    if($this->form_validation->run() == FALSE) {
  			
  			$responseArray = $this->error_response(strip_tags(validation_errors()));
	    }

	    if($this->input->post('password') != $this->input->post('confirm_password')) {
  			
  			$responseArray = $this->error_response(get_response_message(507));
	    }
    }
    
    public function login_post() {

		$auth =$this->request_headers ; // head info 
	

		if($this->input->post('email') =='' ) {
   			
           $this->error_response(get_response_message(506));
	    }

	    if($this->input->post('email') !='') {
			$this->form_validation->set_rules('email', 'Email', 'valid_email',array('valid_email'=>lang('form_validation_valid_emails')));
	    }

	    $this->form_validation->set_rules('password','Password','required|min_length[1]',array('required'=>lang('form_validation_required'),'min_length'=>lang('form_validation_min_length')));
	    $this->form_validation->set_rules('device_token','Device token','required',array('required'=>lang('form_validation_required')));

	    if($this->form_validation->run() == FALSE){
	        $this->error_response(strip_tags(validation_errors()));
	       
	    }
	  	$auth['password'] 		= sanitize_input_text($this->input->post('password'));
	    $auth['device_token'] 	= sanitize_input_text($this->input->post('device_token'));
	    if($this->input->post('email') != "") {
			$where = array('email' => sanitize_input_text($this->input->post('email')));
 			$is_email = $this->auth_model->login_user($auth, $where);

			if($is_email['returnType'] == "SL") {

				$this->appLang = 'english'; //default langauge
				$lang_arr = array('en'=>'english', 'es'=>'spanish');

				if(!empty($is_email['userInfo']->profile_language)){
		            $lang_val = $is_email['userInfo']->profile_language;
		            if(array_key_exists($lang_val , $lang_arr )){
		                $this->appLang = $lang_arr[$lang_val];
		            }
		        }
		        
            	$this->lang->load('response_messages_lang', $this->appLang);
            	$this->lang->load('form_validation_lang', $this->appLang);  //load response lang file

	    		$responseArray = $this->success_response(get_response_message(121),array('user_details'=>$is_email['userInfo']));
 			}

			if($is_email['returnType'] == "WP") {

	    		$this->error_response(get_response_message(523));
	    	}

	    	if($is_email['returnType'] == "SU") {
				
	    		$this->error_response(get_response_message(113));
	    	}

	    	if($is_email['returnType'] == "IA") {
				
	    		$this->error_response(get_response_message(512));
	    	}

			if($is_email['returnType'] == "DU") {
				
	    		$this->error_response(get_response_message(700));
	    	}

    		$this->error_response(get_response_message(526));
		}
	}

    /*
     *  Reset user password. 
    */
  	public function reset_password_put() {

        if(is_valid_mail($this->put('email'))==false) {

			$this->error_response(get_response_message(525));
	    }

	    if($this->put('email') != "") {

			$where = array('email' => sanitize_input_text($this->put('email')));
 			$is_exists = $this->common_model->is_data_exists(USERS, $where);
             

			if(empty($is_exists)){

 			  $this->error_response(get_response_message(521));
	    	}
	    }

        $genrate_password = get_password() ; // for random password
		$password         = password_hash($genrate_password,PASSWORD_DEFAULT);

		$to = $is_exists->email;
		//set data for mail template 
		$data['name'] = $is_exists->full_name;
		$data['password'] = $genrate_password;

		$subject = SITE_NAME."- Reset Password";
		$message = $this->load->view('email/reset_password',$data,TRUE);
		
		$check   =  $this->smtp_email->send_mail($to,$subject,$message);

        if($check !== TRUE){
            $this->error_response($check); //error reponse
        }

        $where_user   = array('userID' =>$is_exists->userID);
		$data_update  = array('password'=>$password,'updated_at'=>datetime());
		$response     = $this->common_model->updateFields(USERS, $data_update, $where_user);

		$this->success_response(get_response_message(522));
  	}

   //Check Social Signup

    public function check_social_signup_put(){

		$headerInfo = $this->request_headers; //Get header Info

		if(empty($this->put('social_id'))) {

			$this->error_response(get_response_message(114)); //error reponse
		}

		if(empty($this->put('social_type'))) { //1:Google, 2:Facebook

			$this->error_response(get_response_message(115)); //error reponse
		}

		if(empty($this->put('device_token'))) {

			$this->error_response(get_response_message(116)); //error reponse
		}

        $socialData['social_id'] = sanitize_input_text($this->put('social_id'));
		$socialData['social_type'] = $this->put('social_type');
		$data['device_token'] = sanitize_input_text($this->put('device_token'));
		$email = !empty($this->put('email')) ? sanitize_input_text($this->put('email')) : NULL; //If email is not empty
		if($socialData['social_type']==3 && empty($this->put('email'))){
  			$email = $socialData['social_id'].'@apple.com';
  		}
  		
		if(!empty($this->put('email'))) {
			
	    	$is_exists_user = $this->user_model->getUserDetails($socialData, $email); //Check user is exist in DB

			if(!empty($is_exists_user)) {

				$this->user_model->checkSocialExist($is_exists_user->userID,$socialData); //check social data exist in DB

				$device_token = $this->put('device_token');

                $device_info = array(
					'user_id'            => $is_exists_user->userID ,
					'device_type'        => $this->request_headers['device-type'],
					'device_id'          => $this->request_headers['device-id'],
					'device_token'       => $device_token,
					'device_timezone'    => $this->request_headers['timezone'],
					'created_at'         => datetime(),
					'updated_at'         => datetime()
				);

		   		$add = $this->auth_model->add_device_info($device_info); // add and update device info

		   		$auth['last_login_at'] = datetime();
		   		$where   = array('userID' =>$is_exists_user->userID);

       			$this->common_model->updateFields(USERS,$auth,$where); // update user table
       			
                $genrate_token = $this->general_model->generate_token($is_exists_user->userID ,$this->request_headers['device-id']); // genrate token

 				$is_exists_user->auth_token = $genrate_token ;

 				$this->appLang = 'english'; //default langauge
				$lang_arr = array('en'=>'english', 'es'=>'spanish');

				if(!empty($is_exists_user->profile_language)) {

		            $lang_val = $is_exists_user->profile_language;

		            if(array_key_exists($lang_val , $lang_arr )){
		                $this->appLang = $lang_arr[$lang_val];
		            }
			    }
            	$this->lang->load('response_messages_lang', $this->appLang);

				$responseArray  = $this->success_response(get_response_message(121),array('user_details'=>$is_exists_user,'social_status'=>1)); // 1: success response
 		    }
 		   

 		    $this->success_response(get_response_message(104),['user_details' =>(object)[], 'social_status' => 0]); // 0: Not found, success response

 		}

        if(empty($this->put('email'))) {

         	$is_exists_user = $this->user_model->getUserDetails($socialData, $email); //get user details 
         	if($is_exists_user){

             	$device_token  = $this->put('device_token');
                $device_info = array(
					'user_id'            => $is_exists_user->userID ,
					'device_type'        => $this->request_headers['device-type'],
					'device_id'          => $this->request_headers['device-id'],
					'device_token'       => $device_token,
					'device_timezone'    => $this->request_headers['timezone'],
					'created_at'         => datetime(),
					'updated_at'         => datetime()
				);

         		$add = $this->auth_model->add_device_info($device_info); // add and update device info
         		$auth['last_login_at'] = datetime();
         		$where   = array('userID' =>$is_exists_user->userID);
                    
       			$this->common_model->updateFields(USERS,$auth,$where); //update users table

                $genrate_token = $this->general_model->generate_token($is_exists_user->userID ,$this->request_headers['device-id']); // genrate token 

 				$is_exists_user->auth_token = $genrate_token ;


				$this->appLang = 'english'; //default langauge
				$lang_arr = array('en'=>'english', 'es'=>'spanish');

				if(!empty($is_exists_user->profile_language)){
		            $lang_val = $is_exists_user->profile_language;
		            if(array_key_exists($lang_val , $lang_arr )){
		                $this->appLang = $lang_arr[$lang_val];
		            }
		        }

            	$this->lang->load('response_messages_lang', $this->appLang);

				$responseArray  = $this->success_response(get_response_message(121),array('user_details'=>$is_exists_user,'social_status'=>1)); // 1: login , sucess response
 		    }
		   
				$this->success_response(get_response_message(104),['user_details' =>(object)[], 'social_status' => 0]); // 0: Not found, success response
		}
	}

    /*
     *   logout user from device .     
    */
  	public function logout_delete() {

        $this->check_service_auth();
		$headerInfo = $this->request_headers; //Get header Info
		$device_id 		= $headerInfo['device-id'];
		$delete 		= array('device_id' => $device_id);
		$delete_data    = $this->common_model->deleteData(USER_DEVICES, $delete);
		$responseArray  = $this->success_response(get_response_message(125));
  	}

    // Skip Step
  	public function skip_step_patch() {

    	$this->check_service_auth();
    	$userData = $this->authData;

        if(empty($this->patch('onboarding_step'))) {

			$this->error_response(get_response_message(117)); //error response
		}

    	if($userData->onboarding_step != $this->patch('onboarding_step')) {

         $this->error_response(get_response_message(308),'Invalid step'); // error response
    	}

        $where_userId = array('userID'=>$this->authData->userID);
    	$data =  array('onboarding_step'=>$userData->onboarding_step + 1); 
        $this->common_model->updateFields(USERS,$data,$where_userId);

        //Get user info
        $user_info = $this->general_model->getUserDetail($this->authData->userID, $this->request_headers['device-id']);
        $this->success_response(get_response_message(118), ['user_details' =>$user_info]);
	}

	//function for check notifcation
	//******************************checking for notification**************************************
	function sendFCM_get() {
		$message['title'] = 'title';
		$message['body'] = 'title';
		$id = "c-cLaCWaU5A:APA91bHpFtxB4aL1XciVkN5aQ7UnTtNDMIUP03frUXLMQvy-eiPO_axuN0kRQW1TAd1KX6l7hTfgdlX5GopodiZLqGKZJjg_pF2A5505wDvI8nfh6GACczCsfUEb8eP-6FQoWqf11PDm"; 

		$API_ACCESS_KEY = getenv('NOTIFICATION_KEY');

		$url = 'https://fcm.googleapis.com/fcm/send';

		$fields = array (
		'registration_ids' => array (
		$id
		),
		'data' => array (
		"message" => $message,
		'message_info' => $message,
		), 
		'priority' => 'high',
		'notification' => array(
		'title' => $message['title'],
		'body' => $message['body'], 
		),
		);
		$fields = json_encode ( $fields );

		$headers = array (
		'Authorization: key=' . $API_ACCESS_KEY,
		'Content-Type: application/json'
		);
		$ch = curl_init ();
		curl_setopt ( $ch, CURLOPT_URL, $url );
		curl_setopt ( $ch, CURLOPT_POST, true );
		curl_setopt ( $ch, CURLOPT_HTTPHEADER, $headers );
		curl_setopt ( $ch, CURLOPT_RETURNTRANSFER, true );
		curl_setopt ( $ch, CURLOPT_POSTFIELDS, $fields );
		$result = curl_exec ( $ch );
		pr($result);
		curl_close ( $ch );
	}
}
