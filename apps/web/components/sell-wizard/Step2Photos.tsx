"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Camera } from "lucide-react";
import StepHeader, { StepFooter, primaryButtonClass, secondaryButtonClass } from "./StepHeader";
import PhoneUploadPanel from "./PhoneUploadPanel";
import SortablePhotoGrid from "./SortablePhotoGrid";
import type { WizardData, UpdateField } from "../SellWizard";

export default function Step2Photos({
  data,
  update,
  onNext,
  onBack,
}: {
  data: WizardData;
  update: UpdateField;
  onNext: () => void;
  onBack: () => void;
}) {
  const canProceed = data.photos.length > 0;
  // A stable setState reference — passed straight to PhoneUploadPanel's
  // onPhotosFound so its polling effect's dependency array stays stable
  // across Step2Photos re-renders (no inline arrow wrapper here).
  const [phonePhotos, setPhonePhotos] = useState<string[]>([]);

  return (
    <div className="flex flex-col gap-6">
      <StepHeader icon={<Camera size={20} />} step={2} title="Add photos">
        Clear, well-lit photos build buyer trust and cut down on condition disputes. Add at least one, then
        drag them into order — the first is your cover photo.
      </StepHeader>

      <PhoneUploadPanel onPhotosFound={setPhonePhotos} />

      <SortablePhotoGrid
        photos={data.photos}
        onChange={(photos) => update("photos", photos)}
        externalPhotos={phonePhotos}
      />

      <StepFooter>
        <button type="button" onClick={onBack} className={secondaryButtonClass}>
          <ArrowLeft size={16} /> Back
        </button>
        <button type="button" disabled={!canProceed} onClick={onNext} className={primaryButtonClass}>
          Continue to price
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
        </button>
      </StepFooter>
    </div>
  );
}
