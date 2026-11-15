import { STATIONS_MAX, STATIONS_MIN } from '@coliseumgrid/core';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';

interface NumberSelectProps {
  label: string;
  value: number;
  choices: readonly number[];
  /** What a choice reads in the list, such as "5 minutes". */
  words?: (choice: number) => string;
  helperText?: string;
  onChange: (value: number) => void;
}

/** A setting with fixed answers is a select, never free text (docs/DESIGN.md, "Fixed answers use a picker"). */
export function NumberSelect({ label, value, choices, words = String, helperText, onChange }: NumberSelectProps) {
  return (
    <TextField select fullWidth label={label} value={value} helperText={helperText} onChange={(event) => onChange(Number(event.target.value))}>
      {choices.map((choice) => (
        <MenuItem key={choice} value={choice}>
          {words(choice)}
        </MenuItem>
      ))}
    </TextField>
  );
}

const STATION_CHOICES = Array.from({ length: STATIONS_MAX - STATIONS_MIN + 1 }, (_, i) => STATIONS_MIN + i);

/** Stations are fixed once a competition starts, because the queue is worked out from them (docs/PLAN.md, "Stations and the queue"). */
export function StationsSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <NumberSelect
      label="Stations"
      value={value}
      choices={STATION_CHOICES}
      helperText="One station is one console. You can't change this later."
      onChange={onChange}
    />
  );
}
