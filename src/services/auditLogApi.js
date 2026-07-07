/*  ******* Data types *******

    audit_log objects must have the following attributes
        - (String) id
        - (String) user_id
        - (String) action
        - (String) target_id
        - (Date) created_at

****************************** */
 

function handleResponse(res){
	if (!res.ok) { return res.text().then(text => { throw new Error(`${text} (status: ${res.status})`)}); }
	return res.json();
}


// Get all audit log entries, reverse chronological order
export async function getAllAuditLogs(){
    const res = await fetch(
        `/api/audit-log/`, 
        {
            method:"GET",
        }
    );

    return handleResponse(res);
}

// Create an audit log entry
export async function addAuditLogEntry(user_id, action, target_id, details){
    const res = await fetch(
        `/api/audit-log/`, 
        {
            method:"POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id, action, target_id, details })
        }
    );

    return handleResponse(res);
}