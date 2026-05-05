import { useState, useEffect, useRef } from 'react';
import './VideoCall.css';

interface VideoCallProps {
  isInitiator: boolean;
  incomingOffer?: RTCSessionDescriptionInit;
  onSendSignal: (type: string, content: string) => void;
  onClose: () => void;
}

export default function VideoCall({ isInitiator, incomingOffer, onSendSignal, onClose }: VideoCallProps) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const handleHangup = () => {
    onSendSignal('call-end', '');
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (pcRef.current) pcRef.current.close();
    onClose();
  };

  // Initialize WebRTC
  useEffect(() => {
    let stream: MediaStream;

    const init = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        const pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });
        pcRef.current = pc;

        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        pc.ontrack = (event) => {
          setRemoteStream(event.streams[0]);
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = event.streams[0];
        };

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            onSendSignal('ice-candidate', JSON.stringify(event.candidate));
          }
        };

        pc.onconnectionstatechange = () => {
          setConnectionState(pc.connectionState);
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            handleHangup();
          }
        };

        if (isInitiator) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          onSendSignal('call-offer', JSON.stringify(offer));
        } else if (incomingOffer) {
          await pc.setRemoteDescription(new RTCSessionDescription(incomingOffer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          onSendSignal('call-answer', JSON.stringify(answer));
        }

      } catch (err) {
        console.error('Error accessing media devices.', err);
        onClose();
      }
    };

    init();

    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (pcRef.current) {
        pcRef.current.close();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(t => {
        t.enabled = !t.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(t => {
        t.enabled = !t.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  // Expose methods to handle incoming signals from ChatView
  useEffect(() => {
    const handleWindowMessage = async (e: MessageEvent) => {
      if (e.data?.type === 'webrtc-signal') {
        const { signalType, content } = e.data.payload;
        const pc = pcRef.current;
        if (!pc) return;

        try {
          if (signalType === 'call-answer' && isInitiator) {
            await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(content)));
          } else if (signalType === 'ice-candidate') {
            await pc.addIceCandidate(new RTCIceCandidate(JSON.parse(content)));
          } else if (signalType === 'call-end') {
            handleHangup();
          }
        } catch (err) {
          console.error('Error handling WebRTC signal', err);
        }
      }
    };
    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInitiator]);

  return (
    <div className="video-call-overlay glass">
      <div className="video-call-container">
        
        <div className="video-main">
          {remoteStream ? (
            <video ref={remoteVideoRef} autoPlay playsInline className="video-remote" />
          ) : (
            <div className="video-waiting">
              <div className="spinner spinner-lg" />
              <p>{connectionState === 'new' ? 'Connecting...' : 'Waiting for video...'}</p>
            </div>
          )}
        </div>

        <div className={`video-pip ${isVideoOff ? 'video-pip--off' : ''}`}>
          <video ref={localVideoRef} autoPlay playsInline muted className="video-local" />
          {isVideoOff && <div className="video-pip-disabled">Camera Off</div>}
        </div>

        <div className="video-controls">
          <button className={`btn-icon video-btn ${isMuted ? 'video-btn--danger' : ''}`} onClick={toggleMute} title="Toggle Mute">
            {isMuted ? '🔇' : '🎤'}
          </button>
          <button className={`btn-icon video-btn ${isVideoOff ? 'video-btn--danger' : ''}`} onClick={toggleVideo} title="Toggle Video">
            {isVideoOff ? '🚫' : '📹'}
          </button>
          <button className="btn-icon video-btn video-btn--hangup" onClick={handleHangup} title="End Call">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
            </svg>
          </button>
        </div>

      </div>
    </div>
  );
}
