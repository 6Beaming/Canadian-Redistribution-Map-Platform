import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  WorkflowActionFooter,
  workflowActionButtonClassName,
} from "@/components/non_prebuilt/WorkflowActionFooter.jsx";
import { useAuth } from "@/contexts/AuthContext.jsx";
import { addComment } from "@/services/commentsApi";
import { toast } from "sonner";

function FieldHoverHint({ message }) {
  return (
    <p
      className={`min-h-[18px] text-[12px] leading-[1.35] text-[#d93025] transition-opacity duration-200 ${message ? "opacity-0 group-hover/comment-control:opacity-100" : "opacity-0"
        }`}
      role={message ? "note" : undefined}
    >
      {message || "\u00a0"}
    </p>
  );
}

export default function UserMakeComments({ proposalId, fedNum, dguid, daName, hasSelection }) {
  const { sessionStatus, user } = useAuth();
  const isSignedIn = sessionStatus === "signed-in";
  const [comment, setComment] = useState("");
  const [title, setTitle] = useState("");

  function handleCommentChange(event) {
    setComment(event.target.value);
  }

  function handleTitleChange(event) {
    setTitle(event.target.value);
  }

  async function handleSubmitComment() {
    if (!isSignedIn) return;

    if (title == "") {
      toast.error("Title cannot be empty.", {
        duration: 1000,
      });
      return;
    }
    if (comment == "") {
      toast.error("Comment cannot be empty", {
        duration: 1000,
      });
      return;
    }

    try {
      await addComment(
        proposalId,
        user.id,
        comment,
        fedNum,
        dguid,
        title,
        null,
        "feedback"
      );

      setTitle("");
      setComment("");
      toast.success("Comment submitted successfully.", {
        duration: 1000,
      });
    } catch (error) {
      console.error("Failed to submit comment:", error);
      toast.error("Failed to submit comment.", {
        duration: 1000,
      });
    }
  }

  const commentFieldMessage = isSignedIn ? "" : SIGN_IN_NOTICE;

  if (!hasSelection) {
    return (
      <section className="min-w-0 text-left">
        <p className="map-info-panel__empty text-left">
          Click a DA on the map to leave a comment.
        </p>
      </section>
    );
  }

  return (
    <section className="grid min-w-0 gap-5 text-left">
      <form className="grid min-w-0 gap-4 text-left">
        <div className="group/comment-control grid min-w-0 gap-1">
          <Label className="justify-self-start text-left" htmlFor="comment-title">Title</Label>
          <Input
            className={
              isSignedIn
                ? "min-w-0 bg-white text-left text-[#3c4043]"
                : "min-w-0 cursor-not-allowed bg-gray-100 text-left text-gray-500"
            }
            disabled={!isSignedIn}
            id="comment-title"
            onChange={handleTitleChange}
            placeholder="Enter a title for your comment."
            value={title}
          />
          <FieldHoverHint message={commentFieldMessage} />
        </div>

        <div className="group/comment-control grid min-w-0 gap-1">
          <Label className="justify-self-start text-left" htmlFor="comment-content">Comment</Label>
          <Textarea
            className={
              isSignedIn
                ? "min-h-32 w-full bg-white text-left text-[#3c4043]"
                : "min-h-32 w-full cursor-not-allowed bg-gray-100 text-left text-gray-500"
            }
            disabled={!isSignedIn}
            id="comment-content"
            onChange={handleCommentChange}
            placeholder={isSignedIn ? `Write your comment about ${daName}.` : "Please sign in to submit your comment."}
            value={comment}
          />
          <FieldHoverHint message={commentFieldMessage} />
        </div>

        <WorkflowActionFooter columns={1}>
          <div className="group/comment-control grid min-w-0 justify-items-end gap-2 text-right">
            <Button
              className={workflowActionButtonClassName}
              disabled={!isSignedIn}
              type="button"
              onClick={handleSubmitComment}
            >
              Submit Comment
            </Button>
            <FieldHoverHint message={commentFieldMessage} />
          </div>
        </WorkflowActionFooter>
      </form>
    </section>
  );
}
