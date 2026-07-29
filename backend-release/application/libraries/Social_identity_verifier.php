<?php

defined('BASEPATH') OR exit('No direct script access allowed');

/**
 * Verifies Google and Apple OpenID Connect ID tokens without trusting profile
 * fields supplied by a client. Public signing keys are cached briefly on disk.
 */
class Social_identity_verifier {

    private $providers = array(
        'google' => array(
            'issuers' => array('accounts.google.com', 'https://accounts.google.com'),
            'jwks' => 'https://www.googleapis.com/oauth2/v3/certs',
            'web_client_env' => 'PARKSWAP_GOOGLE_WEB_CLIENT_ID',
            'allowed_clients_env' => 'PARKSWAP_GOOGLE_ALLOWED_CLIENT_IDS',
        ),
        'apple' => array(
            'issuers' => array('https://appleid.apple.com'),
            'jwks' => 'https://appleid.apple.com/auth/keys',
            'web_client_env' => 'PARKSWAP_APPLE_WEB_CLIENT_ID',
            'allowed_clients_env' => 'PARKSWAP_APPLE_ALLOWED_CLIENT_IDS',
        ),
    );

    public function public_config() {
        return array(
            'google' => $this->provider_config('google'),
            'apple' => $this->provider_config('apple'),
        );
    }

    public function verify($provider, $id_token, $expected_nonce = '') {
        $provider = strtolower(trim((string) $provider));
        if (!isset($this->providers[$provider])) {
            throw new InvalidArgumentException('Unsupported identity provider.');
        }

        $allowed_audiences = $this->allowed_audiences($provider);
        if (empty($allowed_audiences)) {
            throw new RuntimeException(ucfirst($provider).' sign-in is not configured.');
        }

        $parts = explode('.', (string) $id_token);
        if (count($parts) !== 3) {
            throw new InvalidArgumentException('The identity credential is malformed.');
        }

        $header = $this->decode_json_segment($parts[0]);
        $claims = $this->decode_json_segment($parts[1]);
        if (($header['alg'] ?? '') !== 'RS256' || empty($header['kid'])) {
            throw new InvalidArgumentException('The identity credential uses an unsupported signature.');
        }

        $keys = $this->get_jwks($provider);
        $jwk = NULL;
        foreach (($keys['keys'] ?? array()) as $candidate) {
            if (($candidate['kid'] ?? '') === $header['kid'] && ($candidate['kty'] ?? '') === 'RSA') {
                $jwk = $candidate;
                break;
            }
        }
        if (!$jwk) {
            // A provider may have rotated keys between cache refreshes.
            $keys = $this->get_jwks($provider, TRUE);
            foreach (($keys['keys'] ?? array()) as $candidate) {
                if (($candidate['kid'] ?? '') === $header['kid'] && ($candidate['kty'] ?? '') === 'RSA') {
                    $jwk = $candidate;
                    break;
                }
            }
        }
        if (!$jwk || !$this->verify_signature($parts[0].'.'.$parts[1], $parts[2], $jwk)) {
            throw new InvalidArgumentException('The identity credential could not be verified.');
        }

        $now = time();
        if (!in_array((string) ($claims['iss'] ?? ''), $this->providers[$provider]['issuers'], TRUE)) {
            throw new InvalidArgumentException('The identity credential has an invalid issuer.');
        }
        $audiences = is_array($claims['aud'] ?? NULL) ? $claims['aud'] : array((string) ($claims['aud'] ?? ''));
        if (empty(array_intersect($audiences, $allowed_audiences))) {
            throw new InvalidArgumentException('The identity credential was not issued for ParkSwap.');
        }
        if (empty($claims['sub']) || empty($claims['exp']) || (int) $claims['exp'] < ($now - 60)) {
            throw new InvalidArgumentException('The identity credential is expired or incomplete.');
        }
        if (!empty($claims['iat']) && (int) $claims['iat'] > ($now + 300)) {
            throw new InvalidArgumentException('The identity credential has an invalid issue time.');
        }
        if ($expected_nonce !== '' && !hash_equals((string) ($claims['nonce'] ?? ''), (string) $expected_nonce)) {
            throw new InvalidArgumentException('The identity credential nonce does not match.');
        }

        $email = strtolower(trim((string) ($claims['email'] ?? '')));
        $email_verified = $claims['email_verified'] ?? FALSE;
        $email_verified = $email_verified === TRUE || $email_verified === 'true' || $email_verified === 1 || $email_verified === '1';
        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || !$email_verified) {
            throw new InvalidArgumentException('A verified email address is required for ParkSwap sign-in.');
        }

        return array(
            'provider' => $provider,
            'subject' => (string) $claims['sub'],
            'email' => $email,
            'email_verified' => TRUE,
            'name' => trim((string) ($claims['name'] ?? '')),
        );
    }

    private function provider_config($provider) {
        $client_id = trim((string) getenv($this->providers[$provider]['web_client_env']));
        if ($client_id === '' && $provider === 'google') {
            $client_id = '149543713758-id9bq17lmn8rnrqmnlj5knestr76g3qe.apps.googleusercontent.com';
        }
        return array(
            'enabled' => $client_id !== '',
            'client_id' => $client_id,
        );
    }

    private function allowed_audiences($provider) {
        $definition = $this->providers[$provider];
        $values = array(
            trim((string) getenv($definition['web_client_env'])),
        );
        $configured = explode(',', (string) getenv($definition['allowed_clients_env']));
        foreach ($configured as $value) {
            $values[] = trim($value);
        }
        if ($provider === 'google') {
            $values[] = '149543713758-id9bq17lmn8rnrqmnlj5knestr76g3qe.apps.googleusercontent.com';
            $values[] = '149543713758-uvi7naj3b9pjg4007v5hfgungiq4sr88.apps.googleusercontent.com';
        }
        return array_values(array_unique(array_filter($values)));
    }

    private function get_jwks($provider, $force_refresh = FALSE) {
        $cache_file = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR).DIRECTORY_SEPARATOR.'parkswap-'.$provider.'-jwks.json';
        if (!$force_refresh && is_file($cache_file) && filemtime($cache_file) > time() - 21600) {
            $cached = json_decode((string) file_get_contents($cache_file), TRUE);
            if (is_array($cached) && !empty($cached['keys'])) return $cached;
        }

        $ch = curl_init($this->providers[$provider]['jwks']);
        curl_setopt_array($ch, array(
            CURLOPT_RETURNTRANSFER => TRUE,
            CURLOPT_FOLLOWLOCATION => FALSE,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_SSL_VERIFYPEER => TRUE,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => array('Accept: application/json'),
        ));
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $decoded = json_decode((string) $body, TRUE);
        if ($status !== 200 || !is_array($decoded) || empty($decoded['keys'])) {
            throw new RuntimeException('The identity provider is temporarily unavailable.');
        }
        @file_put_contents($cache_file, json_encode($decoded), LOCK_EX);
        return $decoded;
    }

    private function verify_signature($signed_data, $encoded_signature, $jwk) {
        if (empty($jwk['n']) || empty($jwk['e']) || !function_exists('openssl_verify')) return FALSE;
        $public_key = $this->rsa_public_key_pem($jwk['n'], $jwk['e']);
        $signature = $this->base64url_decode($encoded_signature);
        return openssl_verify($signed_data, $signature, $public_key, OPENSSL_ALGO_SHA256) === 1;
    }

    private function rsa_public_key_pem($modulus, $exponent) {
        $modulus = $this->asn1_integer($this->base64url_decode($modulus));
        $exponent = $this->asn1_integer($this->base64url_decode($exponent));
        $rsa = "\x30".$this->asn1_length(strlen($modulus.$exponent)).$modulus.$exponent;
        $algorithm = hex2bin('300d06092a864886f70d0101010500');
        $bit_string = "\x03".$this->asn1_length(strlen($rsa) + 1)."\x00".$rsa;
        $sequence = "\x30".$this->asn1_length(strlen($algorithm.$bit_string)).$algorithm.$bit_string;
        return "-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($sequence), 64, "\n")."-----END PUBLIC KEY-----\n";
    }

    private function asn1_integer($bytes) {
        if ($bytes === '' || (ord($bytes[0]) & 0x80)) $bytes = "\x00".$bytes;
        return "\x02".$this->asn1_length(strlen($bytes)).$bytes;
    }

    private function asn1_length($length) {
        if ($length < 128) return chr($length);
        $encoded = '';
        while ($length > 0) {
            $encoded = chr($length & 0xff).$encoded;
            $length >>= 8;
        }
        return chr(0x80 | strlen($encoded)).$encoded;
    }

    private function decode_json_segment($segment) {
        $decoded = json_decode($this->base64url_decode($segment), TRUE);
        if (!is_array($decoded)) throw new InvalidArgumentException('The identity credential is malformed.');
        return $decoded;
    }

    private function base64url_decode($value) {
        $value = strtr((string) $value, '-_', '+/');
        $padding = strlen($value) % 4;
        if ($padding) $value .= str_repeat('=', 4 - $padding);
        $decoded = base64_decode($value, TRUE);
        if ($decoded === FALSE) throw new InvalidArgumentException('The identity credential is malformed.');
        return $decoded;
    }
}
