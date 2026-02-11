import { useState, useRef, useEffect } from 'react';

export default function TimePicker({ value, onChange }) {
  const [showPicker, setShowPicker] = useState(false);
  const [selectedHour, setSelectedHour] = useState(12);
  const [selectedMinute, setSelectedMinute] = useState(0);
  const [isPM, setIsPM] = useState(false);
  const pickerRef = useRef(null);

  // Parse initial value
  useEffect(() => {
    if (value) {
      const [hours, minutes] = value.split(':').map(Number);
      setSelectedHour(hours % 12 || 12);
      setSelectedMinute(minutes);
      setIsPM(hours >= 12);
    }
  }, [value]);

  // Close picker when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setShowPicker(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleConfirm() {
    let hour24 = selectedHour;
    if (isPM && selectedHour !== 12) hour24 += 12;
    if (!isPM && selectedHour === 12) hour24 = 0;
    const timeStr = `${hour24.toString().padStart(2, '0')}:${selectedMinute.toString().padStart(2, '0')}`;
    onChange(timeStr);
    setShowPicker(false);
  }

  const hours = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const minutes = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  const displayValue = value
    ? (() => {
        const [h, m] = value.split(':').map(Number);
        const hour12 = h % 12 || 12;
        const ampm = h >= 12 ? 'PM' : 'AM';
        return `${hour12}:${m.toString().padStart(2, '0')} ${ampm}`;
      })()
    : '';

  return (
    <div className="relative" ref={pickerRef}>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={displayValue}
          readOnly
          placeholder="Select time"
          className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-verus-blue focus:outline-none cursor-pointer"
          onClick={() => setShowPicker(!showPicker)}
        />
        <button
          type="button"
          onClick={() => setShowPicker(!showPicker)}
          className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white transition-colors"
          title="Select time"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
          </svg>
        </button>
      </div>

      {showPicker && (
        <div className="absolute z-50 mt-2 bg-gray-800 border border-gray-700 rounded-xl shadow-xl p-4 w-72">
          {/* AM/PM Toggle */}
          <div className="flex justify-center gap-1 mb-4 bg-gray-900 rounded-lg p-1">
            <button
              type="button"
              onClick={() => setIsPM(false)}
              className={`flex-1 px-4 py-2 rounded-md font-semibold text-sm tracking-wide transition-all ${
                !isPM
                  ? 'bg-verus-blue text-white shadow-lg shadow-verus-blue/30'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              AM
            </button>
            <button
              type="button"
              onClick={() => setIsPM(true)}
              className={`flex-1 px-4 py-2 rounded-md font-semibold text-sm tracking-wide transition-all ${
                isPM
                  ? 'bg-verus-blue text-white shadow-lg shadow-verus-blue/30'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              PM
            </button>
          </div>

          {/* Hours */}
          <div className="mb-3">
            <p className="text-xs text-gray-400 mb-2 text-center">Hour</p>
            <div className="grid grid-cols-6 gap-1">
              {hours.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setSelectedHour(h)}
                  className={`py-2 rounded text-sm font-medium transition-colors ${
                    selectedHour === h
                      ? 'bg-verus-blue text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {h}
                </button>
              ))}
            </div>
          </div>

          {/* Minutes */}
          <div className="mb-4">
            <p className="text-xs text-gray-400 mb-2 text-center">Minute</p>
            <div className="grid grid-cols-6 gap-1">
              {minutes.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setSelectedMinute(m)}
                  className={`py-2 rounded text-sm font-medium transition-colors ${
                    selectedMinute === m
                      ? 'bg-verus-blue text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {m.toString().padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>

          {/* Preview & Confirm */}
          <div className="flex items-center justify-between pt-3 border-t border-gray-700">
            <span className="text-white font-mono">
              {selectedHour}:{selectedMinute.toString().padStart(2, '0')} {isPM ? 'PM' : 'AM'}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowPicker(false)}
                className="px-3 py-1.5 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="px-4 py-1.5 bg-verus-blue hover:bg-verus-blue/80 text-white rounded-lg font-medium transition-colors"
              >
                Set
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
