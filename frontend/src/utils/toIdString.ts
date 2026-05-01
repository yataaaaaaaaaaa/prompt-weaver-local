export function toIdString(value: string): string {
    const normalized = value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();

    const slug = normalized
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+/g, '')
        .replace(/-+$/g, '')
        .replace(/-+/g, '-');

    return slug || 'id';
}