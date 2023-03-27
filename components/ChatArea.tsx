import * as React from 'react';
import { SxProps } from '@mui/joy/styles/types';
import { Box, List, Option, Select, Stack, Typography, useTheme } from '@mui/joy';
import { ApplicationBar } from '@/components/ApplicationBar';
import { NoSSR } from '@/components/util/NoSSR';
import { SystemPurposeId, SystemPurposes } from '@/lib/data';
import { Message, UiMessage } from '@/components/Message';
import { Composer } from '@/components/Composer';
import { ApiChatInput } from '../pages/api/chat';
import { useSettingsStore } from '@/lib/store';
import Face6Icon from '@mui/icons-material/Face6';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import SmartToyTwoToneIcon from '@mui/icons-material/SmartToyTwoTone';


/// UI Messages configuration

const MessageDefaults: { [key in UiMessage['role']]: Pick<UiMessage, 'role' | 'sender' | 'avatar'> } = {
  system: {
    role: 'system',
    sender: 'Bot',
    avatar: SmartToyTwoToneIcon, //'https://em-content.zobj.net/thumbs/120/apple/325/robot_1f916.png',
  },
  user: {
    role: 'user',
    sender: 'You',
    avatar: Face6Icon, //https://mui.com/static/images/avatar/2.jpg',
  },
  assistant: {
    role: 'assistant',
    sender: 'Bot',
    avatar: SmartToyOutlinedIcon, // 'https://www.svgrepo.com/show/306500/openai.svg',
  },
};

const createUiMessage = (role: UiMessage['role'], text: string): UiMessage => ({
  uid: Math.random().toString(36).substring(2, 15),
  text: text,
  model: '',
  ...MessageDefaults[role],
});


export function ChatArea(props: { onShowSettings: () => void, sx?: SxProps }) {
  const theme = useTheme();
  const { apiKey, chatModelId, systemPurposeId, setSystemPurpose } = useSettingsStore(state => ({
    apiKey: state.apiKey,
    chatModelId: state.chatModelId,
    systemPurposeId: state.systemPurposeId, setSystemPurpose: state.setSystemPurposeId,
  }));
  const [messages, setMessages] = React.useState<UiMessage[]>([]);
  const [abortController, setAbortController] = React.useState<AbortController | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleListClear = () => setMessages([]);

  const handleListDelete = (uid: string) =>
    setMessages(list => list.filter(message => message.uid !== uid));

  const handleListEdit = (uid: string, newText: string) =>
    setMessages(list => list.map(message => (message.uid === uid ? { ...message, text: newText } : message)));

  const handleListRunAgain = (uid: string) => {
    // take all messages until we get to uid, then remove the rest
    const uidPosition = messages.findIndex(message => message.uid === uid);
    if (uidPosition === -1) return;
    const conversation = messages.slice(0, uidPosition + 1);
    setMessages(conversation);

    // noinspection JSIgnoredPromiseFromCall
    getBotMessageStreaming(conversation);
  };

  const handlePurposeChange = (purpose: SystemPurposeId | null) => {
    if (!purpose) return;

    if (purpose === 'Custom') {
      const systemMessage = prompt('Enter your custom AI purpose', SystemPurposes['Custom'].systemMessage);
      SystemPurposes['Custom'].systemMessage = systemMessage || '';
    }

    setSystemPurpose(purpose);
  };

  const handleStopGeneration = () => abortController?.abort();

  const getBotMessageStreaming = async (messages: UiMessage[]) => {
    // when an abort controller is set, the UI switches to the "stop" mode
    const controller = new AbortController();
    setAbortController(controller);

    const payload: ApiChatInput = {
      apiKey: apiKey,
      model: chatModelId,
      messages: messages.map(({ role, text }) => ({
        role: role,
        content: text,
      })),
    };

    try {

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (response.body) {
        const message: UiMessage = createUiMessage('assistant', '');

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');

        // loop forever until the read is done, or the abort controller is triggered
        while (true) {
          const { value, done } = await reader.read();

          if (done) break;

          const messageText = decoder.decode(value);
          message.text += messageText;

          // there may be a JSON object at the beginning of the message, which contains the model name (streaming workaround)
          if (!message.model && message.text.startsWith('{')) {
            const endOfJson = message.text.indexOf('}');
            if (endOfJson > 0) {
              const json = message.text.substring(0, endOfJson + 1);
              try {
                const parsed = JSON.parse(json);
                message.model = parsed.model;
                message.text = message.text.substring(endOfJson + 1);
              } catch (e) {
                // error parsing JSON, ignore
                console.log('Error parsing JSON: ' + e);
              }
            }
          }

          setMessages(list => {
            // if missing, add the message at the end of the list, otherwise set a new list anyway, to trigger a re-render
            const existing = list.find(m => m.uid === message.uid);
            return existing ? [...list] : [...list, message];
          });
        }
      }

    } catch (error: any) {
      if (error?.name === 'AbortError') {
        // expected, the user clicked the "stop" button
      } else {
        // TODO: show an error to the UI
        console.error('Fetch request error:', error);
      }
    }

    // and we're done with this message/api call
    setAbortController(null);
  };

  const handleComposerSendMessage: (text: string) => void = (text) => {

    // seed the conversation with a 'system' message
    const conversation = [...messages];
    if (!conversation.length) {
      const systemMessage = SystemPurposes[systemPurposeId].systemMessage
        .replaceAll('{{Today}}', new Date().toISOString().split('T')[0]);
      conversation.push(createUiMessage('system', systemMessage));
    }

    // add the user message
    conversation.push(createUiMessage('user', text));
    setMessages(conversation);

    // noinspection JSIgnoredPromiseFromCall
    getBotMessageStreaming(conversation);
  };


  const noMessages = !messages.length;

  return (
    <Stack direction='column' sx={{
      minHeight: '100vh',
      ...(props.sx || {}),
    }}>

      {/* Application Bar */}
      <ApplicationBar onDoubleClick={handleListClear} onSettingsClick={props.onShowSettings} sx={{
        position: 'sticky', top: 0, zIndex: 20,
        background: process.env.NODE_ENV === 'development'
          ? theme.vars.palette.danger.solidHoverBg
          : theme.vars.palette.primary.solidHoverBg,
      }} />

      {/* Conversation */}
      <Box sx={{
        flexGrow: 1,
        background: theme.vars.palette.background.level1,
      }}>
        {noMessages ? (
          <Stack direction='column' sx={{ alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}>
            <Box>
              <Typography level='body3' color='neutral'>
                AI purpose
              </Typography>
              <NoSSR>
                <Select value={systemPurposeId} onChange={(e, v) => handlePurposeChange(v)} sx={{ minWidth: '40vw' }}>
                  {Object.keys(SystemPurposes).map(spId => (
                    <Option key={spId} value={spId}>
                      {SystemPurposes[spId as SystemPurposeId]?.title}
                    </Option>
                  ))}
                </Select>
                <Typography level='body2' sx={{ mt: 2, minWidth: 260 }}>
                  {SystemPurposes[systemPurposeId].description}
                </Typography>
              </NoSSR>
            </Box>
          </Stack>
        ) : (
          <>
            <List sx={{ p: 0 }}>
              {messages.map(message =>
                <Message key={'msg-' + message.uid} uiMessage={message} composerBusy={!!abortController}
                         onDelete={() => handleListDelete(message.uid)}
                         onEdit={newText => handleListEdit(message.uid, newText)}
                         onRunAgain={() => handleListRunAgain(message.uid)} />)}
              <div ref={messagesEndRef}></div>
            </List>
          </>
        )}
      </Box>

      {/* Composer */}
      <Box sx={{
        position: 'sticky', bottom: 0, zIndex: 10,
        background: theme.vars.palette.background.body,
        borderTop: `1px solid ${theme.vars.palette.divider}`,
        p: { xs: 1, md: 2 },
      }}>
        <NoSSR>
          <Composer disableSend={!!abortController} sendMessage={handleComposerSendMessage} stopGeneration={handleStopGeneration} />
        </NoSSR>
      </Box>

    </Stack>
  );
}