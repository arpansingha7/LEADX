const generateMockLeads = (count) => {
    const leads = [];
    for (let i = 0; i < count; i++) {
        leads.push({
            name: `Demo User ${i}`,
            phone: `+1555${String(Math.floor(Math.random() * 900000) + 100000)}`,
            email: `demo${i}@example.com`,
            source: 'Demo Script'
        });
    }
    return leads;
};

const runDemo = async () => {
    console.log('Generating 5,000 mock leads...');
    const leads = generateMockLeads(5000);

    const payload = {
        tenant_id: 'default-tenant',
        name: 'Enterprise Demo Campaign',
        leads: leads
    };

    console.log('Sending payload to /campaigns API...');
    try {
        const response = await fetch('http://127.0.0.1:3000/campaigns', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (response.ok) {
            console.log('✅ Success! Campaign Queued.');
            console.log(data);
            console.log('\n👉 Now open http://localhost:3000/campaigns.html in your browser to watch the real-time ingestion analytics!');
        } else {
            console.error('❌ Failed to queue campaign:', data);
        }
    } catch (error) {
        console.error('❌ Error sending request. Is the backend server running?', error.message);
    }
};

runDemo();
