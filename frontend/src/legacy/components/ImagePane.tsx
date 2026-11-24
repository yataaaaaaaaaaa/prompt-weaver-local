import { useCurrentImageStore } from '../stores/currentImageStore';

export default function ImagePane(): JSX.Element {
    const currentMetadata = useCurrentImageStore((state) => state.metadata);
    const currentImage = useCurrentImageStore((state) => state.image);
    return (
        <div className="pane-content-scroll image-only-pane">
            <div className="image-browser-frame image-only-frame">
                {currentImage ? <img src={currentImage} alt={`Output ${currentMetadata?.output_id ?? ''}`} /> : <div className="empty-image">No image selected.</div>}
            </div>
        </div>
    );
}
