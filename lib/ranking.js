// Ranking by how other learners interacted with a video.
// Each signal is smoothed (Bayesian prior) so a brand-new video isn't ranked 100% or 0%.
// The learning signal (quiz accuracy) carries the most weight: the goal is understanding, not watch time.

const WEIGHTS = { quiz: 0.4, completion: 0.25, likes: 0.2, clarity: 0.15 };

function quality(stats = {}) {
  const views = stats.views || 0;
  const quiz = (stats.quizCorrect + 3) / (stats.quizAttempts + 5);
  const completion = (stats.completions + 3) / (views + 5);
  const likes = (stats.likes + 3) / (stats.likes + stats.dislikes + 5);
  // Clarity: fewer "explain this part" requests per view = clearer video.
  const confusion = Math.min(1, (stats.explainRequests + 1) / (views + 5) * 3);
  const clarity = 1 - confusion;
  const score = WEIGHTS.quiz * quiz + WEIGHTS.completion * completion + WEIGHTS.likes * likes + WEIGHTS.clarity * clarity;
  return {
    score: Math.round(score * 100),
    // Below a handful of views the score is mostly prior, so the UI labels it "New" instead.
    confident: views >= 5,
    breakdown: {
      quiz: Math.round(quiz * 100),
      completion: Math.round(completion * 100),
      likes: Math.round(likes * 100),
      clarity: Math.round(clarity * 100),
    },
  };
}

// Search results blend "is this the concept I asked for" with "did it help others".
function rankResults(results) {
  return results
    .map((r) => {
      const q = quality(r.video.stats);
      return { ...r, quality: q, rank: r.similarity * 0.65 + (q.score / 100) * 0.35 };
    })
    .sort((a, b) => b.rank - a.rank);
}

module.exports = { quality, rankResults, WEIGHTS };
