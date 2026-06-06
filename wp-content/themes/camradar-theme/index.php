<?php get_header(); ?>

<main class="max-w-4xl mx-auto px-4 py-10">
  <?php if (have_posts()) : ?>
    <?php while (have_posts()) : the_post(); ?>
      <article class="bg-white rounded-2xl border border-slate-100 p-6 mb-4 shadow-sm">
        <h2 class="text-xl font-black text-slate-900 mb-2">
          <a href="<?php the_permalink(); ?>" class="hover:text-indigo-600 transition-colors"><?php the_title(); ?></a>
        </h2>
        <div class="text-sm text-slate-500"><?php the_excerpt(); ?></div>
      </article>
    <?php endwhile; ?>
    <div class="flex justify-center mt-6">
      <?php the_posts_pagination(); ?>
    </div>
  <?php else : ?>
    <p class="text-center text-slate-400 py-20">게시물이 없습니다.</p>
  <?php endif; ?>
</main>

<?php get_footer(); ?>
