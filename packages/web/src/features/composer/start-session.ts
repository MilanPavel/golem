import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { isInvalidParams, isModelRefused, sendErrorText } from "../../store/errors.ts";
import { NEW_DRAFT_KEY } from "../../store/drafts.ts";
import { useNavigate, useNewSessionModel, usePageActions } from "../../store/page-context.tsx";

export { NEW_DRAFT_KEY };

/**
 * Starts a session in `folder` and sends the first message, then opens the session. A session
 * that was created but whose message failed is reused on the next try, so a retry makes no second one.
 */
export function useStartSession(folder: string | null, model: string | null = null) {
  const actions = usePageActions();
  const navigate = useNavigate();
  const [, chooseModel] = useNewSessionModel();
  const created = useRef<{ folder: string | null; model: string | null; id: string } | null>(null);
  const [folderError, setFolderError] = useState<{ folder: string | null; message: string } | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ text, skill }: { text: string; skill?: { name: string; args: string } }) => {
      setFolderError(null);
      let id = created.current?.folder === folder && created.current.model === model ? created.current.id : null;
      if (id === null) {
        try {
          id = await actions.createSession(folder, model);
        } catch (error) {
          if (isInvalidParams(error) || isModelRefused(error)) {
            setFolderError({ folder, message: error.message });
          }
          throw error;
        }
        created.current = { folder, model, id };
      }
      await actions.send(id, text, skill);
      created.current = null;
      // The pick was for this session. The next new one starts from the default again.
      chooseModel(null);
      navigate(`/s/${id}`);
    },
  });

  const folderMessage = folderError !== null && folderError.folder === folder ? folderError.message : null;
  const failure = mutation.error;
  return {
    send: (text: string, skill?: { name: string; args: string }) =>
      mutation.mutateAsync(skill === undefined ? { text } : { text, skill }),
    pending: mutation.isPending,
    folderError: folderMessage,
    error: failure && folderMessage === null ? sendErrorText(failure) : null,
  };
}
