/*  ******* Data types *******

    submission objects must have the following attributes
        - (String) id
        - (String) user_id
        - (String) content
        - (Date) created_at

****************************** */
 


function handleResponse(res){
	if (!res.ok) {
    return res.json().catch(() => ({})).then((body) => {
      const message = body?.error || `Request failed (${res.status})`;
      throw new Error(message);
    });
  }
	return res.json();
}


// Get total number of comments/submissions
export async function getTotalComments(){
    const res = await fetch(
        `/api/comments/count`,
        {
            method:"GET",
            credentials:"include",
        }
    );

    return handleResponse(res);
}


// Get all comments 
export async function getAllComments(){
    const res = await fetch(
        `/api/comments/`, 
        {
            method:"GET",
            credentials:"include",
        }
    );

    return handleResponse(res);
}

// Exact, geometry-free review-content read for one Workspace submission.
export async function getSubmissionReviewContent(submissionId){
    const params = new URLSearchParams({ submissionId: String(submissionId ?? "") });
    const res = await fetch(
        `/api/comments/?${params.toString()}`,
        {
            method:"GET",
            credentials:"include",
        }
    );
    const rows = await handleResponse(res);
    return Array.isArray(rows) ? rows[0] ?? null : null;
}


// Get all comments for a user_id
export async function getCommentsUser(user_id){
    const res = await fetch(
        `/api/comments/${user_id}`, 
        {
            method:"GET",
            credentials:"include",
        }
    );

    return handleResponse(res);
}


// Add a Comment or Objection submission. Ownership is derived from the session.
export async function addComment(comment, fed_num, dguid, title, neighboring_dguid, type){
    const res = await fetch(
        `/api/comments/`, 
        {
            method:"POST",
            credentials:"include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({comment, fed_num, dguid, title, neighboring_dguid, type})
        }
    );

    return handleResponse(res);
}

// Delete a comment
export async function deleteComment(commentId){
    const res = await fetch(
        `/api/comments/${commentId}`, 
        {
            method:"DELETE",
            credentials:"include",
        }
    );

    return handleResponse(res);
}
