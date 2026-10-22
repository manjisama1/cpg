// The ten characters a player can pick. The number is what the server stores,
// so keep this list in the same order and never reuse an index for a different look.
// (Roles are separate: the Officer, Police, Daket and Chor art is fixed in RoleArt.tsx.)
export const CHARACTER_COUNT = 10;

export const CHARACTERS: readonly { name: string; body: string }[] = [
  { name: 'Coral Beanie', body: '#ff6b57' },
  { name: 'Sky Specs', body: '#5cc8f2' },
  { name: 'Mustard Bandana', body: '#ffc93c' },
  { name: 'Mint Sprout', body: '#62d6a5' },
  { name: 'Pink Kitty', body: '#ff8fb8' },
  { name: 'Purple Wizard', body: '#a98bff' },
  { name: 'Orange Beats', body: '#ff9f43' },
  { name: 'Teal Royal', body: '#3fc1c9' },
  { name: 'Lime Bunny', body: '#b6e04f' },
  { name: 'Peach Shades', body: '#ffb48a' },
];

export const characterName = (i: number) => CHARACTERS[((i % CHARACTER_COUNT) + CHARACTER_COUNT) % CHARACTER_COUNT].name;
