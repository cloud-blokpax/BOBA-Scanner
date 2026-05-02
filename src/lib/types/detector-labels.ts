export type LabelState =
	| 'auto_pending'
	| 'auto_labelled'
	| 'auto_failed'
	| 'human_confirmed'
	| 'human_corrected'
	| 'rejected';

export type Split = 'train' | 'val' | 'test';

export interface DetectorTrainingLabel {
	id: string;
	ebay_item_id: string;
	card_id: string;
	source_url: string;
	source_size: 's-l225' | 's-l500' | 's-l1600';
	image_w: number;
	image_h: number;
	corners_px: number[][] | null;
	label_state: LabelState;
	auto_detection_layer: string | null;
	auto_aspect_ratio: number | null;
	auto_quality_score: number | null;
	split: Split | null;
	reviewed_by: string | null;
	reviewed_at: string | null;
	reject_reason: string | null;
	created_at: string;
	updated_at: string;
}
