import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export default function UserMakeComments() {
  return (
    <div className="grid w-full gap-2">
      <Textarea placeholder="Type your comment here."/>
      <Button>Submit Comment</Button>
    </div>
  )
}
