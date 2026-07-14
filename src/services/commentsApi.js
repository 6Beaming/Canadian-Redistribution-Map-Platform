/*  ******* Data types *******

    comment objects must have the following attributes
        - (String) id
        - (String) proposal_id
        - (String) user_id
        - (String) content
        - (Date) created_at

    comment tags have the following attributes
        - (String) id
        - (String) comment_id
        - (String) tag
        - (Date) created_at

****************************** */
 


function handleResponse(res){
	if (!res.ok) { return res.text().then(text => { throw new Error(`${text} (status: ${res.status})`)}); }
	return res.json();
}


// Get all comments for a Yukon proposal
export async function getCommentsForDA(proposalId){
    const res = await fetch(
        `/api/comments/${proposalId}`, 
        {
            method:"GET",
        }
    );

    return handleResponse(res);
}

// Add a comment to a Yukon proposal
export async function addComment(proposal_id, user_id, comment, fed_num, dguid, title, neighboring_dguid, type){
    const res = await fetch(
        `/api/comments/`, 
        {
            method:"POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({proposal_id, user_id, comment, fed_num, dguid, title, neighboring_dguid, type})
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
        }
    );

    return handleResponse(res);
}

//Get tags for a comment
export async function getCommentTags(commentId){
    const res = await fetch(
        `/api/comment-tags/${commentId}`, 
        {
            method:"GET",
        }
    );

    return handleResponse(res);
}

//Add a tag for a comment
export async function addCommentTag(commentId, tag){
    const res = await fetch(
        `/api/comment-tags/`, 
        {
            method:"POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({comment_id, tag})
        }
    );
}

//remove a tag
export async function deleteCommentTag(tagId){
    const res = await fetch(
        `/api/comment-tags/${tagId}`, 
        {
            method:"DELETE",
        }
    );

    return handleResponse(res);
}