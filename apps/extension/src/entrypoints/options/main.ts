import { getGitHubToken, setGitHubToken } from '../../lib/settings';

const input = document.getElementById('token') as HTMLInputElement;
const status = document.getElementById('status') as HTMLElement;

function flash(text: string): void {
  status.textContent = text;
  setTimeout(() => {
    status.textContent = '';
  }, 2000);
}

void getGitHubToken().then((token) => {
  input.value = token ?? '';
});

document.getElementById('save')!.addEventListener('click', async () => {
  const value = input.value.trim();
  await setGitHubToken(value === '' ? null : value);
  flash('Saved');
});

document.getElementById('clear')!.addEventListener('click', async () => {
  await setGitHubToken(null);
  input.value = '';
  flash('Cleared');
});
