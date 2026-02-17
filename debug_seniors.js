const axios = require('axios');

const API_BASE_URL = 'http://seniorcare.healthsoftcare.in';

const loginAndFetchSeniors = async () => {
    try {
        console.log('Logging in...');
        const loginResponse = await axios.post(`${API_BASE_URL}/api/v1/auth/signin`, {
            email: 'ratnenddr@gmail.com',
            password: 'password'
        });

        const token = loginResponse.data.access_token;
        console.log('Login successful. Token obtained.');
        console.log('User ID:', loginResponse.data.user_id);

        console.log('Fetching My Seniors...');
        const seniorsResponse = await axios.get(`${API_BASE_URL}/api/v1/seniors/my-seniors`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        console.log('Seniors API Response Status:', seniorsResponse.status);
        console.log('Seniors Data:', JSON.stringify(seniorsResponse.data, null, 2));

    } catch (error) {
        console.error('Error:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        } else {
            console.error(error.message);
        }
    }
};

loginAndFetchSeniors();
